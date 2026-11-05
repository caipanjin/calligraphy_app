/**
 * 本列候选切线：从「这一列自己的」行投影里找可能是字间的空白低谷。
 *
 * 只给建议、不替用户做决定：无格行书里字内笔画间隙可能比字间还宽
 * （实测一张行书字帖的某字内部有 18px 空白，而另一列真字间只有 9~12px），
 * 因此这里不做任何「哪个才是真字间」的判定，也不跨列取参考位置。
 *
 * 墨迹掩码复用自动切分链路里已导出的 buildInkMask / projectRows，
 * 保证候选线与自动切分看到的是同一份二值图像；不改切分算法本身。
 */
import { loadImageElement, buildInkMask, projectRows, releaseImageElement } from './segment.js';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const smoothProfile = (sums, window = 3) => {
  const out = new Float32Array(sums.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < sums.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j >= 0 && j < sums.length) {
        sum += sums[j];
        count += 1;
      }
    }
    out[i] = sum / count;
  }
  return out;
};

/** 90 分位，与 findBands 用同一套相对阈值思路，抗个别超密行 */
const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
};

/**
 * 从行投影里找空白低谷（纯函数，便于单测）。
 *
 * @param {ArrayLike<number>} profile 整幅分析图的行投影
 * @param {Object} options
 *   from / to   只在该 y 区间内找（分析图坐标，to 为开区间）
 *   relInk      低于「90 分位 × relInk」视为空白，默认与 findBands 一致取 0.15
 *   minSpacing  相邻候选的最小间距，也是距区间边界的最小距离
 *   maxCount    最多返回多少条（按显著性取前 N，再按 y 排序）
 * @returns {Array<{y:number,width:number,depth:number,score:number}>} y 为分析图坐标
 */
export const findValleys = (profile, options = {}) => {
  if (!profile || profile.length === 0) return [];
  const from = clamp(Math.round(options.from ?? 0), 0, profile.length - 1);
  const to = clamp(Math.round(options.to ?? profile.length), from + 1, profile.length);
  const relInk = Number.isFinite(options.relInk) ? options.relInk : 0.15;
  const minSpacing = Math.max(1, Math.round(options.minSpacing ?? 8));
  const maxCount = Math.max(1, Math.round(options.maxCount ?? 12));

  const smoothed = smoothProfile(profile);
  const minInk = Math.max(1.5, percentile(smoothed, 0.9) * relInk);

  const runs = [];
  let start = -1;
  for (let i = from; i <= to; i += 1) {
    const low = i < to && smoothed[i] < minInk;
    if (low && start < 0) start = i;
    if (!low && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }

  const candidates = [];
  runs.forEach(([s, e]) => {
    // 贴着区间边界的空白不是「字间」：可能是选区落在了页边留白里。
    // 真正的字间低谷两侧都应有墨迹。
    if (s <= from || e >= to) return;
    const width = e - s;
    if (width < 2) return;
    let minVal = Infinity;
    for (let i = s; i < e; i += 1) minVal = Math.min(minVal, smoothed[i]);
    const y = Math.round((s + e - 1) / 2);
    if (y - from < minSpacing || to - y < minSpacing) return;
    candidates.push({
      y,
      width,
      depth: Math.max(0, minInk - minVal),
      // 越宽、越接近全空越显著；只用于「候选太多时先显示哪些」
      score: width + (minInk > 0 ? (1 - minVal / minInk) * 10 : 0)
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.y - b.y);
  const kept = candidates.slice(0, maxCount);
  kept.sort((a, b) => a.y - b.y);
  // 再按位置去重：相邻太近的保留更显著的一条
  return kept.filter((item, i) => i === 0 || item.y - kept[i - 1].y >= minSpacing);
};

/**
 * 按本列的 x 范围与要重切的 y 区间，从原图算出候选切线位置（原图坐标）。
 *
 * @param {string} imageSrc 图片 URL / data URL
 * @param {Object} options { x0, x1, y0, y1, mask? }
 *   x0/x1/y0/y1 均为原图坐标；mask 可传入已算好的 buildInkMask 结果以免重复计算。
 * @returns {Promise<{boundaries:number[], mask:Object, valleys:Array}>}
 */
export const getCandidateBoundaries = async (imageSrc, options = {}) => {
  let mask = options.mask;
  if (!mask) {
    // 缓存命中自动切分时拿不到 mask，才会走这里。用完立刻释放位图，
    // 并把结果裁成精简结构，避免把整份 faint 掩码留在编辑器里。
    const img = await loadImageElement(imageSrc);
    try {
      const full = buildInkMask(img);
      mask = { width: full.width, height: full.height, scale: full.scale, ink: full.ink };
    } finally {
      releaseImageElement(img);
    }
  }
  const s = mask.scale > 0 ? mask.scale : 1;
  const ax0 = clamp(Math.round((options.x0 ?? 0) * s), 0, mask.width - 1);
  const ax1 = clamp(Math.round((options.x1 ?? mask.width / s) * s), ax0 + 1, mask.width);
  const ay0 = clamp(Math.round((options.y0 ?? 0) * s), 0, mask.height - 1);
  const ay1 = clamp(Math.round((options.y1 ?? mask.height / s) * s), ay0 + 1, mask.height);

  const profile = projectRows(mask.ink, mask.width, mask.height, ax0, ax1);
  const valleys = findValleys(profile, {
    from: ay0,
    to: ay1,
    maxCount: options.maxCount ?? 12,
    minSpacing: Math.max(4, Math.round(8 * s))
  });
  return {
    boundaries: valleys.map((v) => Math.round(v.y / s)),
    valleys,
    mask
  };
};
