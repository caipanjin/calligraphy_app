/**
 * 网络请求封装
 *
 * 公众号文章页没有开放 CORS 头，浏览器里直接 fetch 会被拦截。
 * 因此在原生环境用 CapacitorHttp（走原生层，不受同源策略限制），
 * 在浏览器开发环境回退到普通 fetch（配合 dev server 代理）。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (error) {
    return false;
  }
};

/** 判断是否跑在 Web（浏览器）环境 */
export const isWeb = () => !isNative();

/**
 * 以文本形式 GET 一个 URL
 * 原生：CapacitorHttp（无 CORS 限制）
 * Web：fetch（开发时由 vite 代理转发）
 */
export const fetchText = async (url, { timeoutMs = 20000 } = {}) => {
  if (isNative()) {
    const response = await CapacitorHttp.get({
      url,
      // 微信有风控：实测只有带「完整桌面浏览器请求头」才会返回正文，
      // 否则 302 跳到验证码页（wappoc_appmsgcaptcha）。微信 UA 反而会被拦。
      headers: WECHAT_ARTICLE_HEADERS,
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      responseType: 'text'
    });
    return { status: response.status, text: typeof response.data === 'string' ? response.data : String(response.data) };
  }

  // 浏览器开发环境：经 vite 代理转发，避开 CORS
  // 注意：实测最简请求头反而能拿到正文，带完整浏览器头会被微信风控拦到验证码页。
  // 真实的浏览器头由 vite 代理在服务端注入，这里只需一个简单的 Accept。
  const proxied = toDevProxyUrl(url);
  const response = await fetch(proxied, { headers: { Accept: 'text/html' } });
  return { status: response.status, text: await response.text() };
};

/**
 * 把图片下载为 base64 data URL
 * 原生：CapacitorHttp 取二进制
 * Web：fetch + FileReader
 */
export const fetchImageAsDataUrl = async (url, { timeoutMs = 25000 } = {}) => {
  if (isNative()) {
    const response = await CapacitorHttp.get({
      url,
      headers: { Referer: 'https://mp.weixin.qq.com/' },
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      responseType: 'arraybuffer'
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`下载失败(${response.status})`);
    }
    const base64 = arrayBufferToBase64(response.data);
    const mime = guessMimeFromUrl(url);
    return `data:${mime};base64,${base64}`;
  }

  const response = await fetch(toDevProxyUrl(url));
  if (!response.ok) throw new Error(`下载失败(${response.status})`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
};

/** 抓公众号正文所需的请求头（缺一项就可能被风控拦到验证码页） */
export const WECHAT_ARTICLE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1'
};

/** 浏览器开发环境：把公众号域名换成 vite 代理前缀 */
const toDevProxyUrl = (url) => {
  if (url.includes('mp.weixin.qq.com')) {
    return url.replace('https://mp.weixin.qq.com', '/wx-proxy').replace('http://mp.weixin.qq.com', '/wx-proxy');
  }
  if (url.includes('mmbiz.qpic.cn')) {
    return url.replace('https://mmbiz.qpic.cn', '/wx-img').replace('http://mmbiz.qpic.cn', '/wx-img');
  }
  return url;
};

const guessMimeFromUrl = (url) => {
  if (/wx_fmt=png/i.test(url)) return 'image/png';
  if (/wx_fmt=gif/i.test(url)) return 'image/gif';
  if (/wx_fmt=webp/i.test(url)) return 'image/webp';
  return 'image/jpeg';
};

const arrayBufferToBase64 = (buffer) => {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};
