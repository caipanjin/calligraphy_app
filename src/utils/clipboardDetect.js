/**
 * 剪贴板内容检测
 *
 * 用途：用户从微信复制了公众号链接、或从别处复制了图片后，
 * 打开 App 时自动提示导入。
 *
 * 平台差异：
 * - 原生（iOS/Android）：用 @capacitor/clipboard 插件读文本；
 *   读图片需要插件支持 getImage，iOS 上会弹系统授权提示。
 * - Web：navigator.clipboard.readText() 需要用户手势，自动读取通常会被拒绝，
 *   因此 Web 端只做「有内容就提示」，失败时静默跳过。
 */
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (error) {
    return false;
  }
};

/** 从文本里挑出公众号文章链接 */
export const findWeChatArticleUrl = (text) => {
  if (typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/mp\.weixin\.qq\.com\/s\/[^\s"'<>）)】]+/i);
  return match ? match[0] : '';
};

/** 判断文本里是否有 http 链接（非公众号，也可能是别的网页） */
export const findAnyUrl = (text) => {
  if (typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/[^\s"'<>）)】]+/);
  return match ? match[0] : '';
};

/**
 * 解析 @capacitor/clipboard 的 ReadResult（纯函数，便于测试）
 *
 * iOS 原生返回结构（见 Clipboard.swift）：
 *   图片 → { value: 'data:image/png;base64,...', type: 'image/png' }
 *   文本 → { value: '文本内容', type: 'text/plain' }
 * 注意 ReadResult 没有 image 字段，图片是放在 value 里的 data URL。
 */
export const parseClipboardResult = (result) => {
  const empty = { text: '', imageDataUrl: '', imageMime: '' };
  if (!result) return empty;

  const value = result.value == null ? '' : String(result.value);
  const type = result.type == null ? '' : String(result.type);

  const isImage = type.startsWith('image/') || value.startsWith('data:image/');
  if (isImage) {
    const dataUrl = value.startsWith('data:')
      ? value
      : `data:${type || 'image/png'};base64,${value}`;
    return { text: '', imageDataUrl: dataUrl, imageMime: type || 'image/png' };
  }

  return { text: value, imageDataUrl: '', imageMime: '' };
};

/**
 * 读取剪贴板
 * @returns {{ text: string, imageDataUrl: string, imageMime: string }}
 */
export const readClipboard = async () => {
  const empty = { text: '', imageDataUrl: '', imageMime: '' };

  if (isNative()) {
    try {
      return parseClipboardResult(await Clipboard.read());
    } catch (error) {
      return empty;
    }
  }

  // Web：只能读文本，且需要用户手势；自动调用多半会失败
  try {
    const text = await navigator.clipboard.readText();
    return { ...empty, text: text || '' };
  } catch (error) {
    return empty;
  }
};

/**
 * 判断剪贴板内容是否值得提示导入
 * @returns {{ kind: 'wechat'|'image'|'url'|'', payload: string }}
 */
export const detectClipboardImport = async () => {
  const clipboard = await readClipboard();

  // 图片优先：用户复制图片的意图最明确
  if (clipboard.imageDataUrl) {
    return { kind: 'image', payload: clipboard.imageDataUrl };
  }

  if (clipboard.text) {
    const wechatUrl = findWeChatArticleUrl(clipboard.text);
    if (wechatUrl) return { kind: 'wechat', payload: wechatUrl };

    const anyUrl = findAnyUrl(clipboard.text);
    if (anyUrl) return { kind: 'url', payload: anyUrl };
  }

  return { kind: '', payload: '' };
};
