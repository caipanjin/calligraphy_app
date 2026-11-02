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
