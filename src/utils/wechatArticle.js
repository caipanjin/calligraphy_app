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
  if (ratio > 3 || ratio < 0.33) return false;       // 极扁 / 极高：横幅 / 分隔线
  // 正方形且不大（< 1000px）多为头像、二维码、表格截图
  if (ratio === 1 && width < 1000) return false;
  return true;
};

/** 给前端用的提示文案：说明这张图为什么被判为可疑（不直接删除，仅提示） */
export const describeImageRisk = ({ width, height }) => {
  if (!width || !height) return '';
  if (width < 300 || height < 300) return '尺寸过小';
  const ratio = width / height;
  if (ratio > 3 || ratio < 0.33) return '比例异常';
  if (ratio === 1 && width < 1000) return '正方形小图';
  return '';
};

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
