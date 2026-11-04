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

  // 首选方案：createImageBitmap + resizeWidth
  // 关键优势：解码时就直接按目标尺寸采样，**不会把整张原图解码进内存**。
  // 之前的做法是 new Image() + drawImage，需要先解码全尺寸原图
  //（4283x4530 就要 74MB），iOS 内存紧张时 drawImage 会静默失败，
  // canvas 只剩白底 → 表现为「缩略图空白」。
  if (typeof createImageBitmap === 'function') {
    return fetchThumbViaBitmap(dataUrl).then((thumb) => {
      if (thumb) {
        cache.set(dataUrl, thumb);
        return thumb;
      }
      return makeThumbnailFallback(dataUrl);
    });
  }

  return makeThumbnailFallback(dataUrl);
};

/** 用 createImageBitmap 直接按目标尺寸解码（内存占用极低） */
const fetchThumbViaBitmap = async (dataUrl) => {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: THUMB_SIZE,
      resizeQuality: 'high'
    });

    const w = bitmap.width;
    const h = bitmap.height;
    if (w < 8 || h < 8) {
      bitmap.close();
      return '';
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return '';
    }
    // 铺白底：JPEG 不支持透明通道，透明区域会被编码成纯黑
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const thumb = canvas.toDataURL('image/jpeg', 0.75);
    canvas.width = 0;
    canvas.height = 0;

    if (!thumb || !thumb.startsWith('data:image/')) return '';
    return thumb;
  } catch (error) {
    return '';
  }
};

/** 降级方案：new Image + drawImage（老环境或 bitmap 失败时） */
const makeThumbnailFallback = (dataUrl) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;
        const ratio = Math.min(1, THUMB_SIZE / Math.max(naturalW, naturalH));
        const w = Math.max(1, Math.round(naturalW * ratio));
        const h = Math.max(1, Math.round(naturalH * ratio));

        // 尺寸异常（解码失败或极端小图）直接回退原图，避免生成 1x1 的黑块
        if (w < 8 || h < 8) {
          resolve(dataUrl);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // 先铺白底再画图：JPEG 不支持透明通道，透明区域会被编码成纯黑
        // （实测 PNG 带透明背景的字帖缩略图会变成一片黑）。
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        // JPEG 0.75：缩略图体积约 15~30KB，视觉上足够清晰
        const thumb = canvas.toDataURL('image/jpeg', 0.75);
        // 及时释放 canvas 占用的内存
        canvas.width = 0;
        canvas.height = 0;

        // 生成结果为空或异常时回退原图
        if (!thumb || !thumb.startsWith('data:image/')) {
          resolve(dataUrl);
          return;
        }

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
