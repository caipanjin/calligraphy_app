/**
 * 图片缩略图
 *
 * 为什么需要：字帖原图动辄 1500x2500 甚至 4283x4530，
 * 解码后单张就要 14~74MB 内存。字帖库若直接渲染原图，
 * 20 张累计数百 MB，iOS 会因内存不足直接杀掉 App
 * （实测报错：The app has been killed by the operating system
 * because it is using too much memory）。
 *
 * 方案：列表只渲染缩略图（长边 240px，解码后约 0.2MB），
 * 只有进入临摹页时才加载原图。
 */

/** 缩略图长边像素（240 足够 2 倍屏卡片显示，解码后约 0.2MB） */
const THUMB_SIZE = 240;

const cache = new Map();

/**
 * 生成缩略图 data URL
 * @param {string} dataUrl 原图 data URL
 * @returns {Promise<string>} 缩略图 data URL（失败时回退原图）
 */
export const makeThumbnail = (dataUrl) => {
  if (!dataUrl) return Promise.resolve('');

  if (cache.has(dataUrl)) return Promise.resolve(cache.get(dataUrl));

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;
        const ratio = Math.min(1, THUMB_SIZE / Math.max(naturalW, naturalH));
        const w = Math.max(1, Math.round(naturalW * ratio));
        const h = Math.max(1, Math.round(naturalH * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);

        // JPEG 0.75：缩略图体积约 15~30KB，视觉上足够清晰
        const thumb = canvas.toDataURL('image/jpeg', 0.75);
        // 及时释放 canvas 占用的内存
        canvas.width = 0;
        canvas.height = 0;

        cache.set(dataUrl, thumb);
        resolve(thumb);
      } catch (error) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

/** 批量生成缩略图，返回 Map<原图, 缩略图> */
export const makeThumbnails = async (urls) => {
  const result = new Map();
  await Promise.all(
    urls.map(async (url) => {
      result.set(url, await makeThumbnail(url));
    })
  );
  return result;
};

/** 清理缓存（图片被删除时调用） */
export const dropThumbnail = (dataUrl) => {
  cache.delete(dataUrl);
};

/** 清空全部缓存 */
export const clearThumbnailCache = () => {
  cache.clear();
};
