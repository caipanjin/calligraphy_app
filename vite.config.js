import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'node:https';

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

export default defineConfig({
  plugins: [react(), wechatProxyPlugin()],
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
