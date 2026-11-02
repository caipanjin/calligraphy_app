/**
 * 图片内容哈希
 *
 * 用抽样 FNV-1a 计算 data URL 的指纹：字帖可能是几 MB 的 base64，
 * 全量遍历代价高，抽样（最多 20 万个字符）+ 长度即可稳定区分不同图片。
 */
const SAMPLE_LIMIT = 200000;

export const hashImageData = (dataUrl) => {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return 'empty';

  const length = dataUrl.length;
  const stride = Math.max(1, Math.floor(length / SAMPLE_LIMIT));

  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i += stride) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${length.toString(36)}-${hash.toString(36)}`;
};
