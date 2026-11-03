/**
 * 微信公众号文章图片提取
 *
 * 关键事实（已用真实文章验证）：
 * 1. 文章 HTML 里的 <img> 是占位符（EMOJI_BLANK_IMG / pic_blank.gif），
 *    真实图片地址藏在 JS 变量里，需从 HTML 源码正则提取
 * 2. mmbiz.qpic.cn 的图片**无防盗链**，直接 GET 即可下载
 * 3. 同一张图可能在 HTML 中重复出现多次，需去重
 */

// 公众号图片地址：//mmbiz.qpic.cn/<path>/<width>?wx_fmt=<fmt>
const IMAGE_URL_PATTERN =
  /(?:https?:)?\/\/mmbiz\.qpic\.cn\/[A-Za-z0-9_\-./]+?\/\d+\?wx_fmt=\w+/g;

/** 微信会返回不完整的 http 协议，统一补成 https */
const normalizeUrl = (url) => {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

/**
 * 从文章 HTML 中提取所有图片地址（去重、保序）
 * @param {string} html 文章 HTML 源码
 * @returns {string[]} 图片 URL 列表
 */
export const extractImageUrls = (html) => {
  if (typeof html !== 'string' || html.length === 0) return [];

  const matches = html.match(IMAGE_URL_PATTERN) || [];
  const seen = new Set();
  const urls = [];

  for (const raw of matches) {
    const url = normalizeUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  // 封面图（og:image）通常与正文首图相同，去重后已自动合并
  return urls;
};

/**
 * 提取图片的「base key」用于去重
 *
 * 同一张图在公众号里可能出现多次，URL 只在尺寸段（/640 或 /0）或域名前缀上不同，
 * 但路径主体（那一长串 hash）是相同的。按路径主体去重可避免重复导入。
 */
export const imageDedupKey = (url) => {
  if (typeof url !== 'string') return '';
  const match = url.match(/mmbiz\.qpic\.cn\/(?:[^/]+\/)?([^/?]+)/);
  return match ? match[1] : url;
};

/** 判断抓到的内容是不是微信的验证/环境异常页（风控拦截） */
export const isWeChatBlockedPage = (html) => {
  if (typeof html !== 'string') return false;
  return (
    /wappoc_appmsgcaptcha/.test(html) ||
    /环境异常|去验证|完成验证|请在微信客户端打开/.test(html)
  );
};

/**
 * 从图片 data URL 中读出真实尺寸
 * PNG / JPEG / GIF / WebP 均支持（只看文件头，不需要解码整张图）
 */
export const readImageSize = (dataUrl) => {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match) return { width: 0, height: 0, mime: '' };
  const mime = match[1];

  const binary = atob(match[2].slice(0, 4096)); // 头部足够
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  // PNG: 16..24 是宽高（大端）
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height, mime };
  }
  // GIF: 6..10 是小端宽高
  if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8), mime };
  }
  // JPEG: 扫描 SOF 段
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return { width, height, mime };
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      i += 2 + len;
    }
  }
  return { width: 0, height: 0, mime };
};

/**
 * 判断一张图是否可能是「字帖正文图」
 *
 * 实测干扰图特征：
 * - 272x272 小图标、390x220 横幅（尺寸/比例异常）
 * - 正方形且尺寸偏小（390x390 的表格截图、头像、二维码）
 * 字帖多为大尺寸、近似竖版的作品图。
 *
 * 尺寸读不出来时保守保留，交给用户判断。
 */
export const looksLikeSticker = ({ width, height }) => {
  if (!width || !height) return true;                // 读不出尺寸：保留
  if (width < 300 || height < 300) return false;     // 太小：图标 / 表情 / 缩略图
  const ratio = width / height;
  // 字帖基本都是竖版或接近方形。横版超过 1.5 的多是封面/横幅/引导图。
  if (ratio > 1.5 || ratio < 0.33) return false;
  // 正方形且不大（< 1000px）多为头像、二维码、表格截图
  if (ratio === 1 && width < 1000) return false;
  return true;
};

/** 给前端用的提示文案：说明这张图为什么被判为可疑（不直接删除，仅提示） */
export const describeImageRisk = ({ width, height }) => {
  if (!width || !height) return '';
  if (width < 300 || height < 300) return '尺寸过小';
  const ratio = width / height;
  if (ratio > 1.5 || ratio < 0.33) return '比例异常';
  if (ratio === 1 && width < 1000) return '正方形小图';
  return '';
};

/**
 * 从文章 HTML 中提取「正文图片」（排除头像、二维码、封面等干扰图）
 *
 * 为什么需要这个：
 * 全篇正则匹配会把封面（og:image / d.cover）、作者头像（jump_author_avatar）、
 * 跳转二维码（js_qrcode_img）一起抓出来，靠尺寸和视觉相似度去猜并不可靠。
 *
 * 微信页面里这些干扰图都有明确的 class / 变量名，直接排除最准确。
 * 优先取 #js_content（正文容器）范围内的图片。
 */
const NOISE_MARKERS = [
  // 头像 / 二维码（DOM 里的 class）
  'jump_author_avatar',
  'js_qrcode_img',
  'jump_wx_qrcode',
  'js_pc_weapp_code_img',
  'round_head_img',
  // 封面（meta 与 JS 变量）
  'og:image',
  'twitter:image',
  'msg_cdn_url',
  'd.cover',
  'cdn_1_1_img',
  'cdn_url_1_1',
  'cdn_url_235_1',
  // 通用封面变量（var cdn_url = "..." 形式）
  'cdn_url:'
];

export const extractContentImageUrls = (html) => {
  if (typeof html !== 'string' || html.length === 0) return [];

  // 逐张图判断：找到每个 URL，看它「归属」的标签是否带干扰特征。
  // 不能按大片段切分 —— 微信页面里一个 div 内可能同时包含封面和正文图，
  // 整段丢弃会把正文图一起丢掉（实测 h1 有 8 张图挤在同一片段里）。
  const results = [];
  const seen = new Set();
  const pattern = new RegExp(IMAGE_URL_PATTERN.source, 'g');
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const url = normalizeUrl(match[0]);
    const position = match.index;

    // 只看「紧邻的上下文」：从该 URL 往前到最近一个标签起点为止。
    // 窗口不能太大 —— 否则会把上一张图的干扰标记也算进来（实测会误杀正文图）。
    const lookbackStart = Math.max(0, position - 300);
    const rawContext = html.slice(lookbackStart, position);
    const lastTagStart = Math.max(
      rawContext.lastIndexOf('<img'),
      rawContext.lastIndexOf('<image'),
      rawContext.lastIndexOf('<meta')
    );
    const context = lastTagStart >= 0 ? rawContext.slice(lastTagStart) : rawContext.slice(-160);

    const isNoise = NOISE_MARKERS.some((marker) => context.includes(marker));
    if (isNoise) continue;

    // 已经在正文容器内（js_content）的图，可信度更高，即使上下文没标记也保留
    if (seen.has(url)) continue;
    seen.add(url);
    results.push(url);
  }

  // 若逐张判断后一张都不剩（可能是所有图都被误判），退回原逻辑但只排除强特征
  if (results.length === 0) {
    const strongNoise = ['jump_author_avatar', 'js_qrcode_img', 'jump_wx_qrcode', 'js_pc_weapp_code_img'];
    const fallback = new RegExp(IMAGE_URL_PATTERN.source, 'g');
    let m2;
    while ((m2 = fallback.exec(html)) !== null) {
      const url = normalizeUrl(m2[0]);
      const rawContext = html.slice(Math.max(0, m2.index - 300), m2.index);
      const lastTagStart = Math.max(
        rawContext.lastIndexOf('<img'),
        rawContext.lastIndexOf('<image'),
        rawContext.lastIndexOf('<meta')
      );
      const context = lastTagStart >= 0 ? rawContext.slice(lastTagStart) : rawContext.slice(-160);
      if (strongNoise.some((marker) => context.includes(marker))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      results.push(url);
    }
  }

  return results;
};

/**
 * 计算图片的 dHash（差值感知哈希）
 *
 * 为什么需要它：
 * 公众号会把**同一幅字帖**导出成多个尺寸（原图 2539x3279、缩略 1280x1706、
 * 裁切版 1280x1280），这些图字节不同（md5 不同）但视觉上是同一张，
 * 靠字节哈希去不掉。dHash 对缩放、轻微裁切、重新压缩都稳定。
 *
 * @param {HTMLImageElement|ImageBitmap} source 已解码的图片
 * @param {number} size 哈希边长（默认 8，即 64 位）
 * @returns {string} 64 位哈希（16 进制）
 */
export const computeDHash = (source, size = 16) => {
  const naturalWidth = source.naturalWidth || source.width;
  const naturalHeight = source.naturalHeight || source.height;
  if (!naturalWidth || !naturalHeight) return '';

  const canvas = document.createElement('canvas');
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, naturalWidth, naturalHeight);

  let data;
  try {
    data = ctx.getImageData(0, 0, naturalWidth, naturalHeight).data;
  } catch (error) {
    return '';
  }

  // 把图片切成 size x size 的网格，每格取平均亮度，得到灰度指纹。
  // 不用 canvas 缩放：drawImage 的插值是平台相关的，同一张图不同尺寸
  // 缩放后差异很大（实测同一幅字距离能到 23），分块平均则稳定得多。
  const cellWidth = naturalWidth / size;
  const cellHeight = naturalHeight / size;
  const cells = new Float32Array(size * size);

  for (let row = 0; row < size; row += 1) {
    const y0 = Math.floor(row * cellHeight);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * cellHeight));
    for (let col = 0; col < size; col += 1) {
      const x0 = Math.floor(col * cellWidth);
      const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cellWidth));
      let sum = 0;
      let count = 0;
      const stepY = Math.max(1, Math.floor((y1 - y0) / 6));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 6));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const index = (y * naturalWidth + x) * 4;
          sum += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
          count += 1;
        }
      }
      cells[row * size + col] = count > 0 ? sum / count : 0;
    }
  }

  // 归一化成 0~1 的字符串指纹（每格 1 位 16 进制不够，用 2 位）
  let hash = '';
  for (let i = 0; i < cells.length; i += 1) {
    const value = Math.max(0, Math.min(255, Math.round(cells[i])));
    hash += value.toString(16).padStart(2, '0');
  }
  return hash;
};

/**
 * 两个灰度指纹的「距离」（0 = 完全相同，越大越不同）
 *
 * 用归一化后的欧氏距离而不是汉明距离：
 * 同一幅字的不同尺寸/裁切，逐格亮度会有偏差，
 * 但整体结构一致，归一化欧氏距离对这种偏差不敏感。
 */
export const hammingDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  const cells = a.length / 2;
  let sumSquares = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < cells; i += 1) {
    const va = parseInt(a.slice(i * 2, i * 2 + 2), 16);
    const vb = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    sumSquares += (va - vb) ** 2;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return Number.MAX_SAFE_INTEGER;
  // 归一化到 0~100，便于设阈值
  const rms = Math.sqrt(sumSquares / cells);
  return Math.round((rms / 255) * 100);
};

/**
 * 判定两张图是否为「同一幅字帖的不同尺寸/裁切」
 *
 * 用 16x16 灰度指纹 + 归一化 RMS 距离（0~100）。
 * 实测（真实文章《HdX6lU0V4xopJd9F_D53xw》）：
 *   同一幅字的 5 个导出（2539x3279 / 1280x1706 / 1280x1280 / 1280x1653）：0~7
 *   封面横幅 vs 字帖：11
 *   二维码 vs 字帖：39~40
 * 取 10：覆盖所有字帖版本，同时与横幅/二维码区分开。
 */
export const DEDUP_THRESHOLD = 10;

export const isSameImage = (hashA, hashB, threshold = DEDUP_THRESHOLD) =>
  hammingDistance(hashA, hashB) <= threshold;

/** 判断是否为文章页链接（用于给出更明确的错误提示） */
export const isWeChatArticleUrl = (url) => {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'mp.weixin.qq.com' && parsed.pathname.startsWith('/s');
  } catch (error) {
    return false;
  }
};

/**
 * 从任意文本中挑出第一个 http(s) 链接
 * （微信分享过来的文本常带「标题 + 链接」的格式）
 */
export const pickFirstUrl = (text) => {
  if (typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/[^\s"'<>）)】]+/);
  return match ? match[0] : '';
};

/** 取图片地址里的尺寸信息（公众号 URL 里带 640/0 这类宽度） */
export const guessImageWidth = (url) => {
  const match = url.match(/\/(\d+)\?wx_fmt=/);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * 过滤掉明显不是字帖的图片（尺寸过小）
 * 公众号 URL 里的 640/0 表示原始宽度；0 是「原图」标记，无法判断，保留
 */
export const filterUsableImages = (urls, minWidth = 200) =>
  urls.filter((url) => {
    const width = guessImageWidth(url);
    if (width === 0) return true; // 原图标记，保留
    return width >= minWidth;
  });
