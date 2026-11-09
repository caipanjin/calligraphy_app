import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 公众号文章抓取中间件（仅开发环境使用）
 *
 * 为什么不用 vite 的 proxy：
 * http-proxy 会把浏览器的 Cookie（rewardsn、wxtokenkey）、Referer、
 * Sec-Fetch-* 等头一起透传给微信，服务端据此返回「精简页」。
 * 这里用 node 原生 https 发一个干净的请求，完全可控。
 *
 * 请求头规律（实测，很反直觉但稳定）：
 *   仅 UA                        → 200，2.6MB，含正文 ✓
 *   UA + Accept + Accept-Lang    → 302 跳验证码页 ✗
 *   UA + 全套头                   → 200 但只有压缩壳
 * 所以这里只发 UA。
 *
 * ⚠️ 微信还有按 IP 的限流：短时间内多次抓取会返回 31652 字节的「精简页」
 *    （HTTP 200，但没有 js_content）。冷却几分钟后可恢复。
 *    前端已做检测与提示，并缓存已成功的文章。
 */
const fetchWechatArticle = (targetPath) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'mp.weixin.qq.com',
        path: targetPath,
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        }
      },
      (res) => {
        // 跟随重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const location = res.headers.location;
          const nextPath = location.startsWith('http')
            ? new URL(location).pathname + (new URL(location).search || '')
            : location;
          fetchWechatArticle(nextPath).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });

const wechatProxyPlugin = () => ({
  name: 'wechat-proxy',
  configureServer(server) {
    server.middlewares.use('/wx-proxy', async (req, res) => {
      try {
        const result = await fetchWechatArticle(req.url || '/');
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        // 微信会带 max-age=500 的缓存头；若浏览器缓存了「精简页」，
        // 之后永远拿到旧的精简页，所以这里强制不缓存。
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.end(result.body);
      } catch (error) {
        res.statusCode = 502;
        res.end(`proxy error: ${error.message}`);
      }
    });
  }
});

/**
 * 调试桥接（仅开发服务器）：把当前打开的字帖原图 + 切分结果写到本机临时目录，
 * 命令行侧可直接读取并离线复现切分，不用用户手动导出/发送图片。
 *
 *   apply: 'serve' → 生产构建与 iOS/Android 包完全不含这段代码
 *   数据只在 localhost 内流动，落盘到 os.tmpdir()/calligraphy-debug，不联网
 *   关闭：CALLIGRAPHY_DEBUG_BRIDGE=0 npm run dev，或移除本插件
 *
 * 落盘文件：
 *   current.<ext>  当前页原图（每次换页覆盖，旧扩展名自动清理）
 *   current.json   本次捕获的元信息（时间、页面、图片字节数、切分结果等）
 *   state.json     最近一次状态快照，含 IndexedDB 的 segmentations / 版面设置
 *
 * ⚠️ 采集脚本绝不能抢在 App 之前「创建」数据库：带版本号 open 一个不存在的库，
 *    会触发 0→5 升级却没有 onupgradeneeded，生成 version=5、零 object store 的空库；
 *    随后 App 的 open(name, 5) 因版本相同不再升级，永远建不出表，导入必然失败。
 *    所以只打开「已存在」的库，且不带版本号。
 *    若本机曾被旧版桥接污染，访问 /__debug/reset 可一次性删除该空库。
 */
const DEBUG_BRIDGE_DIR = path.join(os.tmpdir(), 'calligraphy-debug');
const DEBUG_BRIDGE_MAX_BODY = 24 * 1024 * 1024;
const DEBUG_BRIDGE_MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif'
};

// 注入页面的采集脚本。刻意不用模板字符串 / 反引号，便于外层 String.raw 包裹。
const DEBUG_BRIDGE_CLIENT = String.raw`
(() => {
  const ENDPOINT = '/__debug/report';
  let lastSrc = '';
  let lastState = '';
  let busy = false;

  // 只打开「已存在」的库，且不带版本号：绝不抢在 App 前创建空库。
  // 见 vite.config.js 顶部 debugBridgePlugin 注释（version=5 零 object store 的坑）。
  const openExistingDB = () => new Promise((resolve) => {
    if (!indexedDB.databases) { resolve(null); return; }
    let dbsReq;
    try { dbsReq = indexedDB.databases(); } catch (e) { resolve(null); return; }
    dbsReq.onerror = () => resolve(null);
    dbsReq.onsuccess = () => {
      const found = (dbsReq.result || []).some((item) => item.name === 'calligraphyImages');
      if (!found) { resolve(null); return; }
      let req;
      try { req = indexedDB.open('calligraphyImages'); } catch (e) { resolve(null); return; }
      req.onerror = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
    };
  });

  // 一次打开 DB，同时读切分缓存与「当前页原图」。
  // 原图优先取 DOM 的 .stage-image；单字模式 / 切分面板下没有它时，
  // 用 meta.current 指针回 pages store 取原图，绝不退化成 240px 缩略图。
  const collect = () => new Promise((resolve) => {
    // storeNames: null = 库尚不存在（App 会自己建，正常）；[] = 库存在却零表（坏库）
    const empty = () => ({ stores: {}, storeNames: null, dataUrl: '', pageId: '' });
    openExistingDB().then((db) => {
      if (!db) { resolve(empty()); return; }
      const names = ['segmentations', 'segmentationSettings', 'meta', 'albums'];
      const out = empty();
      // 库健康度：版本已是 5 却零 object store，就是旧版桥接污染过的坏库
      out.storeNames = [];
      try { out.storeNames = Array.from(db.objectStoreNames); } catch (e) {}
      let left = names.length + 1;
      const done = () => {
        left -= 1;
        if (left === 0) { try { db.close(); } catch (e) {} resolve(out); }
      };
      names.forEach((name) => {
        try {
          const request = db.transaction(name, 'readonly').objectStore(name).getAll();
          request.onsuccess = () => { out.stores[name] = request.result; done(); };
          request.onerror = () => { out.stores[name] = []; done(); };
        } catch (e) { out.stores[name] = []; done(); }
      });
      try {
        const metaReq = db.transaction('meta', 'readonly').objectStore('meta').get('current');
        metaReq.onerror = () => done();
        metaReq.onsuccess = () => {
          const cursor = metaReq.result;
          if (!cursor || !cursor.pageId) { done(); return; }
          out.pageId = cursor.pageId;
          const pageReq = db.transaction('pages', 'readonly').objectStore('pages').get(cursor.pageId);
          pageReq.onerror = () => done();
          pageReq.onsuccess = () => {
            if (pageReq.result && pageReq.result.dataUrl) out.dataUrl = pageReq.result.dataUrl;
            done();
          };
        };
      } catch (e) { done(); }
    });
  });

  const post = (body) => fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(() => {});

  const stageImage = () => {
    const stage = document.querySelector('img.stage-image');
    return stage && stage.src.indexOf('data:image') === 0 ? stage.src : '';
  };

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const collected = await collect();
      const fromStage = stageImage();
      const src = fromStage || collected.dataUrl;
      const meta = {
        ts: Date.now(),
        url: location.href,
        pageId: collected.pageId,
        source: fromStage ? 'stage-image' : (collected.dataUrl ? 'indexeddb:pages' : 'none'),
        stores: collected.stores,
        storeNames: collected.storeNames,
        currentSrcLength: src.length,
        currentSrcPrefix: src.slice(0, 48)
      };
      const hash = JSON.stringify(meta.stores) + JSON.stringify(meta.storeNames);
      if (src && src !== lastSrc) {
        lastSrc = src;
        lastState = hash;
        // 换页：连原图一起上报
        await post(Object.assign({}, meta, { dataUrl: src }));
      } else if (hash !== lastState) {
        // 图没变但切分框 / 版面设置变了：只发轻量状态，不重传大图
        lastState = hash;
        await post(meta);
      }
    } finally {
      busy = false;
    }
  };

  new MutationObserver(() => { tick(); }).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['src']
  });
  setInterval(tick, 3000);
  tick();
})();
`;

const debugBridgePlugin = () => ({
  name: 'debug-bridge',
  apply: 'serve',
  configureServer(server) {
    fs.mkdirSync(DEBUG_BRIDGE_DIR, { recursive: true });
    console.log(`[debug-bridge] 采集目录: ${DEBUG_BRIDGE_DIR}`);

    // 一次性修复：删掉旧版桥接误建的「version=5 但零 object store」空库。
    // 这个页面不加载 App，不会与它抢 IndexedDB 连接；只在同一标签页访问才有效。
    server.middlewares.use('/__debug/reset', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset="utf-8"><title>重置本地字帖库</title>
<body style="font:14px/1.6 system-ui;padding:24px">
<p id="msg">正在删除本机 localhost:5173 的字帖数据库，然后返回首页…</p>
<script>
  const done = () => { location.replace('/'); };
  try {
    const r = indexedDB.deleteDatabase('calligraphyImages');
    r.onsuccess = done;
    r.onerror = done;
    r.onblocked = () => {
      document.getElementById('msg').textContent = '数据库被其它标签页占用，请关闭其它字帖页后刷新本页。';
    };
    setTimeout(done, 3000);
  } catch (e) { done(); }
</script>
</body>`);
    });

    server.middlewares.use('/__debug/report', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('POST only');
        return;
      }
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > DEBUG_BRIDGE_MAX_BODY) {
          req.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const { dataUrl, ...meta } = payload;
          const stamp = new Date().toISOString();
          fs.writeFileSync(
            path.join(DEBUG_BRIDGE_DIR, 'state.json'),
            JSON.stringify({ ...meta, updatedAt: stamp }, null, 2)
          );
          if (!dataUrl) {
            res.statusCode = 204;
            res.end();
            return;
          }
          const matched = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
          if (!matched) {
            res.statusCode = 400;
            res.end('bad dataUrl');
            return;
          }
          const ext = DEBUG_BRIDGE_MIME_EXT[matched[1]] || 'png';
          const bytes = Buffer.from(matched[2], 'base64');
          const file = `current.${ext}`;
          fs.writeFileSync(path.join(DEBUG_BRIDGE_DIR, file), bytes);
          // 换页后清掉其它格式的旧图，避免命令行侧误读上一张
          for (const name of fs.readdirSync(DEBUG_BRIDGE_DIR)) {
            if (/^current\.[a-z]+$/.test(name) && name !== file) {
              fs.rmSync(path.join(DEBUG_BRIDGE_DIR, name), { force: true });
            }
          }
          fs.writeFileSync(
            path.join(DEBUG_BRIDGE_DIR, 'current.json'),
            JSON.stringify({ ...meta, updatedAt: stamp, file, mime: matched[1], bytes: bytes.length }, null, 2)
          );
          console.log(`[debug-bridge] 捕获当前字帖图 ${(bytes.length / 1024).toFixed(0)}KB → ${path.join(DEBUG_BRIDGE_DIR, file)}`);
          res.statusCode = 204;
          res.end();
        } catch (error) {
          res.statusCode = 400;
          res.end(`debug bridge error: ${error.message}`);
        }
      });
    });
  },
  transformIndexHtml(html) {
    return html.replace('</body>', `<script>${DEBUG_BRIDGE_CLIENT}</script>\n  </body>`);
  }
});

const debugBridgeEnabled = process.env.CALLIGRAPHY_DEBUG_BRIDGE !== '0';

export default defineConfig({
  plugins: [react(), wechatProxyPlugin(), ...(debugBridgeEnabled ? [debugBridgePlugin()] : [])],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/wx-img': {
        target: 'https://mmbiz.qpic.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx-img/, ''),
        headers: { Referer: 'https://mp.weixin.qq.com/' }
      }
    }
  }
});
