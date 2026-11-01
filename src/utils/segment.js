/**
 * 字帖自动切分（投影法）
 *
 * 思路：书法字帖背景干净、字距规整，用「墨迹投影」找空白带来切分，
 * 不需要任何模型，毫秒级完成，结果确定。
 *
 *   竖排：先按列切（垂直投影找列间空白），再在每列内按行切
 *   横排：先按行切，再在每行内按列切
 *
 * 与 OCR 的本质区别：只回答「字在哪」，不猜「字是什么」——
 * 后者对毛笔字做不到，前者是纯几何问题。
 */

// 分析用图的最大边长（太大只影响速度，不影响切分质量）
const MAX_ANALYSIS_SIZE = 1600;
// 判定「有墨」的投影阈值：占该轴投影 90 分位值的比例
// （绝对值在实拍照片上会失效——噪点和底色不均会让空白列也被判成有墨）
const INK_RATIO = 0.15;
const INK_PERCENTILE = 0.9;
// 空白带最小宽度占比（小于它的空白视为字内笔画间隙）
const GAP_RATIO = 0.008;
// 单个字块最小边长占比
const MIN_SIZE_RATIO = 0.015;
// 单字最大边长占比（超过说明整页被当成一个字）
const MAX_SIZE_RATIO = 0.85;
// 判定为「多个字粘在一起」的倍数（相对中位字高/宽）
const MERGE_FACTOR = 1.85;

export const loadImageElement = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });

/** Otsu 阈值 */
export const otsuThreshold = (histogram, total) => {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    weightB += histogram[i];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += i * histogram[i];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }
  return threshold;
};

/**
 * 生成墨迹掩码：缩放 → 灰度 → Otsu 二值化 → 反色修正
 * 返回的 scale 是「分析图坐标 / 原图坐标」
 */
export const buildInkMask = (img, maxSize = MAX_ANALYSIS_SIZE) => {
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  const ratio = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * ratio));
  const height = Math.max(1, Math.round(naturalHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const g = value | 0;
    gray[p] = g;
    histogram[g] += 1;
  }

  const threshold = otsuThreshold(histogram, width * height);
  const ink = new Uint8Array(width * height);
  let inkCount = 0;
  for (let p = 0; p < gray.length; p += 1) {
    if (gray[p] < threshold) {
      ink[p] = 1;
      inkCount += 1;
    }
  }

  // 白字黑底时反色
  if (inkCount > width * height * 0.6) {
    for (let p = 0; p < ink.length; p += 1) ink[p] ^= 1;
  }

  return { width, height, ink, threshold, scale: width / naturalWidth };
};

/** 垂直投影：每一列有多少墨迹像素 */
export const projectColumns = (ink, width, height, y0 = 0, y1 = height) => {
  const sums = new Uint32Array(width);
  for (let y = y0; y < y1; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      if (ink[rowStart + x]) sums[x] += 1;
    }
  }
  return sums;
};

/** 水平投影：每一行有多少墨迹像素 */
export const projectRows = (ink, width, height, x0 = 0, x1 = width) => {
  const sums = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    for (let x = x0; x < x1; x += 1) {
      if (ink[rowStart + x]) sums[y] += 1;
    }
  }
  return sums;
};

/**
 * 从投影数组里找出「有墨的连续段」
 * @param {Uint32Array} sums 投影值
 * @param {Object} options minInk 判定有墨的阈值；minGap 视为分隔的最小空白；minSize 段的最小长度
 */
/** 滑动平均，抑制投影里的单像素噪声 */
const smoothProfile = (sums, window = 3) => {
  if (window <= 1) return sums;
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

/** 分位数：用 90 分位而非最大值作参考，避免个别超密列拉高阈值 */
const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
};

export const findBands = (sums, { relInk = INK_RATIO, minGap, minSize, smooth = 3 }) => {
  const profile = smoothProfile(sums, smooth);
  const reference = percentile(profile, INK_PERCENTILE);
  const minInk = Math.max(1.5, reference * relInk);

  const runs = [];
  let start = -1;

  for (let i = 0; i <= profile.length; i += 1) {
    const active = i < profile.length && profile[i] >= minInk;
    if (active && start < 0) start = i;
    if (!active && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }

  // 合并间距小于 minGap 的相邻段（同一字内部的笔画间隙）
  const merged = [];
  runs.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s - last[1] < minGap) last[1] = e;
    else merged.push([s, e]);
  });

  return merged
    .filter(([s, e]) => e - s >= minSize)
    .map(([s, e]) => ({ start: s, end: e }));
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** 把明显偏大（多个字粘在一起）的字块按中位尺寸等分 */
const splitOversized = (boxes, axis) => {
  if (boxes.length < 3) return boxes;
  const sizes = boxes.map((box) => (axis === 'vertical' ? box.height : box.width));
  const typical = median(sizes);
  if (!typical) return boxes;

  const result = [];
  boxes.forEach((box) => {
    const size = axis === 'vertical' ? box.height : box.width;
    const parts = Math.round(size / typical);
    if (parts <= 1 || size < typical * MERGE_FACTOR) {
      result.push(box);
      return;
    }
    const step = size / parts;
    for (let i = 0; i < parts; i += 1) {
      result.push(
        axis === 'vertical'
          ? { ...box, y: box.y + step * i, height: step }
          : { ...box, x: box.x + step * i, width: step }
      );
    }
  });
  return result;
};

/**
 * 主入口：把整幅字帖切成一个个单字
 * @returns {Promise<{boxes: Array, layout: string, columns: number, scale: number, failed: boolean, reason?: string}>}
 */
export const segmentCharacters = async (imageSrc, options = {}) => {
  const { maxSize = MAX_ANALYSIS_SIZE, layout: forcedLayout = 'auto' } = options;
  const img = await loadImageElement(imageSrc);
  const { width: W, height: H, ink, scale } = buildInkMask(img, maxSize);

  const gapCol = Math.max(2, Math.round(W * GAP_RATIO));
  const gapRow = Math.max(2, Math.round(H * GAP_RATIO));
  const minSizeCol = Math.max(2, Math.round(W * MIN_SIZE_RATIO));
  const minSizeRow = Math.max(2, Math.round(H * MIN_SIZE_RATIO));

  const colBands = findBands(projectColumns(ink, W, H), {
    relInk: INK_RATIO,
    minGap: gapCol,
    minSize: minSizeCol
  });
  const rowBands = findBands(projectRows(ink, W, H), {
    relInk: INK_RATIO,
    minGap: gapRow,
    minSize: minSizeRow
  });

  // 版面判定：
  // 1) 只有一列（多行）→ 竖排；只有一行（多列）→ 横排
  // 2) 少行多列（行数 ≤2 且列数 ≥3）→ 横排
  // 3) 其余默认竖排（书法字帖的常态）
  // 判定只影响阅读顺序与标签，用户可在面板上手动切换
  const detectLayout = () => {
    if (colBands.length === 1 && rowBands.length > 1) return 'vertical';
    if (rowBands.length === 1 && colBands.length > 1) return 'horizontal';
    if (rowBands.length <= 2 && colBands.length >= 3) return 'horizontal';
    return 'vertical';
  };

  const layout = forcedLayout !== 'auto' ? forcedLayout : detectLayout();

  const toSource = (box) => ({
    x: box.x / scale,
    y: box.y / scale,
    width: box.width / scale,
    height: box.height / scale
  });

  let boxes = [];
  let columnCount = 0;

  if (layout === 'vertical') {
    columnCount = colBands.length;
    // 竖排从右往左读
    [...colBands].reverse().forEach((col) => {
      const charBands = findBands(projectRows(ink, W, H, col.start, col.end), {
        relInk: INK_RATIO,
        minGap: gapRow,
        minSize: minSizeRow
      });
      charBands.forEach((band) => {
        boxes.push(
          toSource({
            x: col.start,
            y: band.start,
            width: col.end - col.start,
            height: band.end - band.start
          })
        );
      });
    });
    boxes = splitOversized(boxes, 'vertical');
  } else {
    columnCount = rowBands.length;
    rowBands.forEach((row) => {
      const charBands = findBands(projectColumns(ink, W, H, row.start, row.end), {
        relInk: INK_RATIO,
        minGap: gapCol,
        minSize: minSizeCol
      });
      charBands.forEach((band) => {
        boxes.push(
          toSource({
            x: band.start,
            y: row.start,
            width: band.end - band.start,
            height: row.end - row.start
          })
        );
      });
    });
    boxes = splitOversized(boxes, 'horizontal');
  }

  // 过滤异常块（过大 = 整页被当成一个字；过小 = 噪点）
  const maxW = (W / scale) * MAX_SIZE_RATIO;
  const maxH = (H / scale) * MAX_SIZE_RATIO;
  const usable = boxes.filter((box) => box.width <= maxW && box.height <= maxH && box.width > 4 && box.height > 4);

  if (usable.length === 0) {
    return { boxes: [], layout, columns: columnCount, scale, failed: true, reason: 'empty' };
  }

  return {
    boxes: usable,
    layout,
    columns: columnCount,
    scale,
    failed: false,
    charSize: {
      width: median(usable.map((box) => box.width)),
      height: median(usable.map((box) => box.height))
    }
  };
};
