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

/**
 * 用列投影的自相关估计「字距」（一个字占的宽度）
 * 搜索范围限制在图宽的 8%~40%，避免锁到笔画级的周期性
 */
export const estimatePitch = (profile, minRatio = 0.08, maxRatio = 0.4) => {
  const n = profile.length;
  if (n < 8) return { pitch: 0, score: 0 };

  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += profile[i];
  mean /= n;

  const centered = new Float32Array(n);
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    centered[i] = profile[i] - mean;
    variance += centered[i] * centered[i];
  }
  if (variance <= 0) return { pitch: 0, score: 0 };

  const lo = Math.max(4, Math.round(n * minRatio));
  const hi = Math.min(n - 2, Math.round(n * maxRatio));
  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = lo; lag <= hi; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += centered[i] * centered[i + lag];
    const score = sum / variance;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return { pitch: bestLag, score: bestScore };
};

/**
 * 墨迹外接框：按投影分位裁剪，忽略边缘阴影/杂质
 * （直接用极值会被照片边缘的暗边污染，导致整张网格偏移）
 */
const inkBounds = (ink, width, height, ratio = 0.02) => {
  const colSums = new Uint32Array(width);
  const rowSums = new Uint32Array(height);
  let maxCol = 0;
  let maxRow = 0;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      if (ink[rowStart + x]) {
        colSums[x] += 1;
        rowSum += 1;
      }
    }
    rowSums[y] = rowSum;
    if (rowSum > maxRow) maxRow = rowSum;
  }
  for (let x = 0; x < width; x += 1) if (colSums[x] > maxCol) maxCol = colSums[x];
  if (maxCol === 0 || maxRow === 0) return null;

  const colThreshold = Math.max(1, maxCol * ratio);
  const rowThreshold = Math.max(1, maxRow * ratio);

  let minX = -1;
  let maxX = -1;
  let minY = -1;
  let maxY = -1;
  for (let x = 0; x < width; x += 1) {
    if (colSums[x] >= colThreshold) {
      if (minX < 0) minX = x;
      maxX = x;
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (rowSums[y] >= rowThreshold) {
      if (minY < 0) minY = y;
      maxY = y;
    }
  }
  if (minX < 0 || minY < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

/**
 * 在给定格子内按真实墨迹重新定位并居中
 * 网格只负责「大概在哪」，这个函数负责「字到底在哪、多大」
 */
const refineToGlyph = (ink, width, height, box, shrinkRatio = 0.08, marginRatio = 0.14) => {
  const insetX = box.width * shrinkRatio;
  const insetY = box.height * shrinkRatio;
  const x0 = Math.max(0, Math.round(box.x + insetX));
  const x1 = Math.min(width, Math.round(box.x + box.width - insetX));
  const y0 = Math.max(0, Math.round(box.y + insetY));
  const y1 = Math.min(height, Math.round(box.y + box.height - insetY));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let inkCount = 0;

  for (let y = y0; y < y1; y += 1) {
    const rowStart = y * width;
    for (let x = x0; x < x1; x += 1) {
      if (ink[rowStart + x]) {
        inkCount += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  if (inkCount / area < 0.02 || maxX < 0) return null;

  const glyphWidth = maxX - minX + 1;
  const glyphHeight = maxY - minY + 1;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const size = Math.max(glyphWidth, glyphHeight) * (1 + marginRatio * 2);

  // 不超过格子本身，避免压到邻格
  const finalWidth = Math.min(box.width, size);
  const finalHeight = Math.min(box.height, size);

  return {
    x: Math.min(Math.max(centerX - finalWidth / 2, box.x), box.x + box.width - finalWidth),
    y: Math.min(Math.max(centerY - finalHeight / 2, box.y), box.y + box.height - finalHeight),
    width: finalWidth,
    height: finalHeight
  };
};

/** 区域内的墨迹占比 */
const inkCoverage = (ink, width, x0, y0, w, h) => {
  const x1 = Math.min(width, Math.round(x0 + w));
  const y1 = Math.round(y0 + h);
  let inkCount = 0;
  let total = 0;
  for (let y = Math.max(0, Math.round(y0)); y < y1; y += 1) {
    const rowStart = y * width;
    for (let x = Math.max(0, Math.round(x0)); x < x1; x += 1) {
      total += 1;
      if (ink[rowStart + x]) inkCount += 1;
    }
  }
  return total > 0 ? inkCount / total : 0;
};

/**
 * 用字距拆分过宽的带：宽度明显大于一个字距，说明这里有多个列/字粘在一起
 */
const splitBandsByPitch = (bands, pitch, factor = 1.6) => {
  if (!pitch || pitch <= 0) return bands;
  const result = [];
  bands.forEach((band) => {
    const size = band.end - band.start;
    const parts = Math.round(size / pitch);
    if (parts > 1 && size > pitch * factor) {
      const step = size / parts;
      for (let i = 0; i < parts; i += 1) {
        result.push({
          start: Math.round(band.start + i * step),
          end: Math.round(band.start + (i + 1) * step)
        });
      }
    } else {
      result.push(band);
    }
  });
  return result;
};

/**
 * 按字距拟合规则网格（用于字距过密、投影切不干净的字帖）
 * 汉字接近方形，所以用列方向估出的字距同时作为行距
 */
export const buildGridBoxes = (ink, width, height, pitch, layout = 'vertical') => {
  const bounds = inkBounds(ink, width, height);
  if (!bounds || pitch <= 0) return [];

  const columns = Math.max(1, Math.round(bounds.width / pitch));
  const rows = Math.max(1, Math.round(bounds.height / pitch));
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;

  const boxes = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const cell = {
        x: bounds.x + c * cellWidth,
        y: bounds.y + r * cellHeight,
        width: cellWidth,
        height: cellHeight
      };
      // 先粗判是否有墨，再按真实墨迹居中
      if (inkCoverage(ink, width, cell.x, cell.y, cell.width, cell.height) < 0.02) continue;
      const refined = refineToGlyph(ink, width, height, cell);
      if (refined) boxes.push(refined);
    }
  }

  // 阅读顺序：竖排从右往左、横排从左往右
  boxes.sort((a, b) => {
    const rowDiff = Math.round((a.y - b.y) / Math.max(1, cellHeight * 0.5));
    if (rowDiff !== 0) return rowDiff;
    return layout === 'vertical' ? b.x - a.x : a.x - b.x;
  });

  return boxes;
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
 * 列内字数归一：按众数裁掉多出来的框
 * 字帖的每列字数通常一致（末列可能少），个别列多出来的通常是贴边残块或非文字
 */
const normalizeColumnCounts = (boxes, columnRanges, layout) => {
  if (boxes.length < 4 || !columnRanges.length) return boxes;

  const groups = columnRanges.map(() => []);
  boxes.forEach((box) => {
    const center = layout === 'vertical' ? box.x + box.width / 2 : box.y + box.height / 2;
    let bestIndex = -1;
    let bestDistance = Infinity;
    columnRanges.forEach((range, index) => {
      const rangeCenter = (range.start + range.end) / 2;
      const distance = Math.abs(center - rangeCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) groups[bestIndex].push(box);
  });

  const counts = groups.map((group) => group.length).filter((count) => count > 0);
  if (counts.length < 3) return boxes;

  // 众数（出现次数最多的字数）；并列则不动
  const tally = new Map();
  counts.forEach((count) => tally.set(count, (tally.get(count) || 0) + 1));
  let mode = 0;
  let modeHits = 0;
  let tie = false;
  tally.forEach((hits, count) => {
    if (hits > modeHits) {
      mode = count;
      modeHits = hits;
      tie = false;
    } else if (hits === modeHits) {
      tie = true;
    }
  });
  if (tie || mode <= 0) return boxes;

  const kept = [];
  groups.forEach((group) => {
    if (group.length <= mode) {
      kept.push(...group);
      return;
    }
    // 多出来的从末尾裁掉（竖排取 y 最大的，横排取 x 最大的）
    const sorted = [...group].sort((a, b) => (layout === 'vertical' ? a.y - b.y : a.x - b.x));
    kept.push(...sorted.slice(0, mode));
  });

  return kept.length > 0 ? kept : boxes;
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

  const colProfile = projectColumns(ink, W, H);
  const { pitch } = estimatePitch(colProfile);

  // 列带先用投影找，再用字距把粘连的多列拆开
  const rawColBands = findBands(colProfile, {
    relInk: INK_RATIO,
    minGap: gapCol,
    minSize: minSizeCol
  });
  const colBands = splitBandsByPitch(rawColBands, pitch);

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
    // 只有一列（多行）→ 竖排；只有一行（多列）→ 横排
    if (colBands.length === 1 && rowBands.length > 1) return 'vertical';
    if (rowBands.length === 1 && colBands.length > 1) return 'horizontal';
    // 其余一律按竖排（书法字帖的常态）。规则网格下两种解读切出的框相同，
    // 只有阅读顺序不同，面板上可一键切换。
    return 'vertical';
  };

  let layout = forcedLayout !== 'auto' ? forcedLayout : detectLayout();

  const toSource = (box) => ({
    x: box.x / scale,
    y: box.y / scale,
    width: box.width / scale,
    height: box.height / scale
  });

  let boxes = [];
  let columnCount = 0;
  const columnDetail = [];

  if (layout === 'vertical') {
    columnCount = colBands.length;
    // 竖排从右往左读
    [...colBands].reverse().forEach((col) => {
      const charBands = splitBandsByPitch(
        findBands(projectRows(ink, W, H, col.start, col.end), {
          relInk: INK_RATIO,
          minGap: gapRow,
          minSize: minSizeRow
        }),
        pitch
      );
      columnDetail.push({ width: col.end - col.start, bands: charBands.length, sizes: charBands.map((b) => b.end - b.start) });
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
  let usable = boxes.filter((box) => box.width <= maxW && box.height <= maxH && box.width > 4 && box.height > 4);

  // 过滤碎片：明显小于中位字块的（通常是贴边被截断的半行或噪点）
  if (usable.length >= 5) {
    const medianW = median(usable.map((box) => box.width));
    const medianH = median(usable.map((box) => box.height));
    usable = usable.filter(
      (box) => box.width >= medianW * 0.35 && box.height >= medianH * 0.45
    );
  }

  // 字距估计 + 退化检测：
  // 字距过密时投影切不开（整列被当成一个字），此时改用规则网格拟合
  let strategy = 'projection';
  const debug = {
    projectionBoxes: usable.length,
    medianWidth: Math.round(median(usable.map((b) => b.width))),
    medianHeight: Math.round(median(usable.map((b) => b.height))),
    pitchInSource: Math.round(pitch / scale),
    columns: colBands.length,
    rawColumns: rawColBands.length,
    columnDetail
  };
  if (pitch > 0) {
    // 注意：usable 里的框已经是原图坐标（toSource 转过），字距也要换算到原图尺度
    const pitchInSource = pitch / scale;
    const medianWidth = median(usable.map((box) => box.width));
    const medianHeight = median(usable.map((box) => box.height));
    const degenerate =
      usable.length === 0 ||
      medianWidth > pitchInSource * 1.8 ||
      medianHeight > pitchInSource * 1.8;

    if (degenerate) {
      // 网格模式下投影判定已失效，回落到书法默认的竖排（用户可手动切换）
      const gridLayout = forcedLayout !== 'auto' ? forcedLayout : 'vertical';
      const gridBoxes = buildGridBoxes(ink, W, H, pitch, gridLayout).map(toSource);
      if (gridBoxes.length > 0) {
        usable = gridBoxes;
        strategy = 'grid';
        layout = gridLayout;
      }
    }
  }

  // 列内字数归一（去掉多出来的残块）
  if (usable.length > 0) {
    const ranges =
      layout === 'vertical'
        ? colBands.map((band) => ({ start: band.start / scale, end: band.end / scale }))
        : rowBands.map((band) => ({ start: band.start / scale, end: band.end / scale }));
    usable = normalizeColumnCounts(usable, ranges, layout);
  }

  if (usable.length === 0) {
    return { boxes: [], layout, columns: columnCount, scale, failed: true, reason: 'empty' };
  }

  return {
    boxes: usable,
    layout,
    columns: columnCount,
    strategy,
    debug,
    pitch: pitch / scale,
    scale,
    failed: false,
    charSize: {
      width: median(usable.map((box) => box.width)),
      height: median(usable.map((box) => box.height))
    }
  };
};
