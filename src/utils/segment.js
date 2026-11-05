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

// 注意：若本文件的改动会改变「同一张图切出哪些框」，
// 必须把 src/utils/segmentCache.js 的 SEGMENT_ALGORITHM_VERSION +1，
// 否则用户装了新版仍会命中旧算法缓存，看不到新结果。
// 有真实图 golden 夹具（npm test）守住输出，升级版本时按需更新快照。

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

  // 格线掩码：比「局部背景」略暗、但不是墨迹的细结构
  // （格线通常是浅褐/浅灰细线，Otsu 会把它归入背景，需单独提取）
  const faint = new Uint8Array(width * height);
  const window = 7;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (ink[p]) continue;
      // 局部背景：窗口内灰度中位数
      const values = [];
      for (let dy = -window; dy <= window; dy += 3) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -window; dx <= window; dx += 3) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          values.push(gray[yy * width + xx]);
        }
      }
      if (values.length === 0) continue;
      values.sort((a, b) => a - b);
      const background = values[Math.floor(values.length / 2)];
      const delta = background - gray[p];
      if (delta > 6 && gray[p] > threshold) faint[p] = 1;
    }
  }

  return { width, height, ink, faint, threshold, scale: width / naturalWidth };
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

/**
 * 找回被 minSize 过滤掉的「极扁但极宽」的段（典型是「一」字）
 *
 * 「一」只有一横，高度可能只有 8~9px，远低于 minSize（约 H×1.5%）。
 * 但它的**墨迹横跨整个列宽**，这是它与噪点/残块最本质的区别。
 * 一维投影看不到宽度，只能在调用处补偿。
 */
const recoverFlatStrokes = (ink, W, colStart, colEnd, bands, minSize, minGap) => {
  const colWidth = colEnd - colStart;
  if (colWidth <= 0 || minSize <= 0) return bands;

  const height = ink.length / W;
  const prof = projectRows(ink, W, height, colStart, colEnd);
  const all = findBands(prof, { relInk: INK_RATIO, minGap, minSize: 1 });
  const dropped = all.filter((band) => band.end - band.start < minSize);
  if (dropped.length === 0) return bands;

  // 如果一列里有多个被过滤的小段，说明它们是规律性的装饰线/格线残留
  // （实测：带格线的字帖每列都有 3~5 个），而不是孤立的「一」字。
  // 真正独立的「一」在一列里最多出现 1 次。
  if (dropped.length > 1) return bands;

  const recovered = [];
  for (const band of dropped) {
    let minX = colEnd;
    let maxX = colStart;
    let inkCount = 0;
    for (let y = band.start; y < band.end; y += 1) {
      for (let x = colStart; x < colEnd; x += 1) {
        if (ink[y * W + x]) {
          inkCount += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (inkCount === 0) continue;
    const inkWidth = maxX - minX + 1;
    // 墨迹横跨列宽 70% 以上才算「简单笔画字」（「一」几乎占满）
    if (inkWidth < colWidth * 0.7) continue;

    // 密度校验：真正的「一」是粗壮的一横，框内墨迹占比高；
    // 装饰线/分割线虽然也占满宽度，但细如发丝，密度极低（实测 0%）。
    const boxArea = (band.end - band.start) * (maxX - minX + 1);
    const density = boxArea > 0 ? inkCount / boxArea : 0;
    if (density < 0.25) continue;

    // 与相邻字带的间距校验：独立的「一」上下都有明显空白；
    // 而被拆分边界切出来的笔触残留会紧贴相邻字（间距 0~5px）。
    const neighbors = bands.filter((b) => b !== band);
    const gapAbove = neighbors
      .filter((b) => b.end <= band.start)
      .reduce((min, b) => Math.min(min, band.start - b.end), Infinity);
    const gapBelow = neighbors
      .filter((b) => b.start >= band.end)
      .reduce((min, b) => Math.min(min, b.start - band.end), Infinity);
    const nearestGap = Math.min(gapAbove, gapBelow);
    if (!Number.isFinite(nearestGap) || nearestGap < Math.max(4, minGap * 0.5)) continue;

    // 打标记：normalizeColumnCounts 裁剪时豁免这类「简单笔画字」
    recovered.push({ ...band, simpleStroke: true });
  }

  if (recovered.length === 0) return bands;
  return [...bands, ...recovered].sort((a, b) => a.start - b.start);
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
 * 搜索范围默认限制在图宽的 8%~40%，避免锁到笔画级或图案级的周期性。
 * 双联等宽间隔版式由 needsWidePitchSearch 判定后传入更大的上限。
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
 * 是否需要放宽字距搜索上限到 0.55W。
 *
 * 双联 / 条幅只有两列、列心距接近半幅图宽，真实列周期会落在 0.4W 之外；
 * 旧上限把真实周期排除后，自相关只能锁到笔画级短周期，splitBandsByPitch
 * 会把两条宽列各拆成 3 条窄列，整条链路失效。
 *
 * 但不能全局放宽：导入面板缩略图网格、界面截图这类重复图案会在 0.47W
 * 附近形成更强的伪周期，反而把多列并成一列。因此只在同时满足以下条件时放宽：
 *   1. 恰好两条列带；
 *   2. 每条都明显窄于整幅（<0.3W）——排除一条覆盖全宽的图案列带；
 *   3. 两条宽度接近（>=60%）——排除一侧是边框/题款的不对称版式；
 *   4. 列心距落在 (0.4W, 0.55W) ——正好是旧上限漏掉、放宽后能覆盖的区间。
 */
export const needsWidePitchSearch = (bands, W) => {
  if (!Array.isArray(bands) || bands.length !== 2 || !(W > 0)) return false;
  const [a, b] = bands;
  const widthA = a.end - a.start;
  const widthB = b.end - b.start;
  if (Math.max(widthA, widthB) > W * 0.3) return false;
  if (Math.min(widthA, widthB) < Math.max(widthA, widthB) * 0.6) return false;
  const centers = ((b.start + b.end) - (a.start + a.end)) / 2;
  return centers > W * 0.4 && centers < W * 0.55;
};

/**
 * 取单个字带在垂直方向上的真实水平范围
 *
 * 同一列里字的宽度常常不一样（实测列宽 65px，而字最宽可达 83px），
 * 若直接用列宽当字框宽度，稍宽的字左右会被裁掉。
 * 这里沿着这一行扫描墨迹，把左右边界扩到字的真实边缘。
 *
 * @param {Uint8Array} ink 墨迹掩码
 * @param {number} width 图宽
 * @param {number} y0 字带上边界
 * @param {number} y1 字带下边界
 * @param {number} colStart 列左边界
 * @param {number} colEnd 列右边界
 * @param {number} maxOverflow 允许向两侧扩展的最大比例（相对列宽）
 */
export const measureGlyphHorizontally = (
  ink,
  width,
  y0,
  y1,
  colStart,
  colEnd,
  maxOverflow = 0.6,
  neighborGap = Infinity
) => {
  const columnWidth = colEnd - colStart;
  // 扩展上限：先受列宽比例限制，再受「到相邻墨迹的空隙」限制
  // 左右分别限额：各自不超过「该方向到最近墨迹的距离」的 45%，
  // 且不超过列宽的 30%（字距密集的字帖上这是唯一安全的做法）
  const byRatio = Math.max(2, Math.round(columnWidth * maxOverflow));
  // 有相邻墨迹时以空隙为准（各留 45%），否则按列宽比例
  const byGap = Number.isFinite(neighborGap)
    ? Math.max(2, Math.round(neighborGap * 0.45))
    : byRatio;
  const limitLeft = Math.max(2, Math.min(byRatio, byGap));
  const limitRight = limitLeft;

  const hasInkAt = (x) => {
    for (let y = y0; y < y1; y += 1) {
      if (ink[y * width + x]) return true;
    }
    return false;
  };

  // 允许穿过少量空白（笔画边缘抗锯齿会造成 1~3px 的浅色断点）
  const TOLERANCE = 3;

  let left = colStart;
  let extendLeft = 0;
  let gap = 0;
  for (let x = colStart - 1; x >= Math.max(0, colStart - limitLeft); x -= 1) {
    if (hasInkAt(x)) {
      left = x;
      extendLeft = colStart - x;
      gap = 0;
    } else if (++gap > TOLERANCE) {
      break;
    }
  }

  let right = colEnd;
  let extendRight = 0;
  gap = 0;
  for (let x = colEnd; x < Math.min(width, colEnd + limitRight); x += 1) {
    if (hasInkAt(x)) {
      right = x + 1;
      extendRight = x + 1 - colEnd;
      gap = 0;
    } else if (++gap > TOLERANCE) {
      break;
    }
  }

  return { left, right, extendLeft, extendRight };
};

/**
 * 取单个字带垂直方向的真实上下范围
 *
 * 与水平方向同理：切分只保证「大概在一个字的高度内」，
 * 但笔画可能上下探出（如长竖、末笔下沉），直接用字带边界会裁掉。
 * 这里在字的水平范围内向上/下扫描墨迹，扩到真实边缘。
 */
export const measureGlyphVertically = (
  ink,
  width,
  height,
  x0,
  x1,
  y0,
  y1,
  maxOverflow = 0.6,
  gapUp = Infinity,
  gapDown = Infinity
) => {
  const bandHeight = y1 - y0;
  const byRatio = bandHeight * maxOverflow;
  // 上下各自限额：上方受 gapUp 约束，下方受 gapDown 约束
  const limitUp = Math.max(
    2,
    Math.round(Math.min(byRatio, Number.isFinite(gapUp) ? gapUp * 0.45 : Infinity))
  );
  const limitDown = Math.max(
    2,
    Math.round(Math.min(byRatio, Number.isFinite(gapDown) ? gapDown * 0.45 : Infinity))
  );

  const hasInkAt = (y) => {
    const base = y * width;
    for (let x = x0; x < x1; x += 1) {
      if (ink[base + x]) return true;
    }
    return false;
  };

  const TOLERANCE = 3;

  let top = y0;
  let extendUp = 0;
  let gap = 0;
  for (let y = y0 - 1; y >= Math.max(0, y0 - limitUp); y -= 1) {
    if (hasInkAt(y)) {
      top = y;
      extendUp = y0 - y;
      gap = 0;
    } else if (++gap > TOLERANCE) {
      break;
    }
  }

  let bottom = y1;
  let extendDown = 0;
  gap = 0;
  for (let y = y1; y < Math.min(height, y1 + limitDown); y += 1) {
    if (hasInkAt(y)) {
      bottom = y + 1;
      extendDown = y + 1 - y1;
      gap = 0;
    } else if (++gap > TOLERANCE) {
      break;
    }
  }

  return { top, bottom, extendUp, extendDown };
};

/**
 * 按阅读顺序排序
 *
 * 竖排：先分列（从右到左），列内从上到下
 * 横排：先分行（从上到下），行内从左到右
 *
 * 注意不能「先按 y 分组再按 x 排」——那会变成逐行横向走，与竖排阅读习惯相反。
 */
const sortByReadingOrder = (boxes, layout, cellSize) => {
  const step = Math.max(1, cellSize || 1);
  if (layout === 'vertical') {
    boxes.sort((a, b) => {
      // 竖排从右往左读：x 大的列在前
      const colDiff = Math.round((b.x - a.x) / (step * 0.5));
      if (colDiff !== 0) return colDiff;
      return a.y - b.y; // 同列内从上到下
    });
  } else {
    boxes.sort((a, b) => {
      const rowDiff = Math.round((a.y - b.y) / (step * 0.5));
      if (rowDiff !== 0) return rowDiff;
      return a.x - b.x;
    });
  }
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
  sortByReadingOrder(boxes, layout, cellWidth);

  return boxes;
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

  // 只裁掉「贴边且偏小」的多余块（被页面边缘截断的残块）。
  // 注意：不能只按尺寸判断——同一页里笔画简单的字本来就可能偏小（实测 112 vs 233 都正常）。
  const allSizes = [];
  groups.forEach((group) => {
    group.forEach((box) => {
      allSizes.push(layout === 'vertical' ? box.height : box.width);
    });
  });
  if (allSizes.length === 0) return boxes;
  const sortedSizes = [...allSizes].sort((a, b) => a - b);
  const typicalSize = sortedSizes[Math.floor(sortedSizes.length / 2)];
  // 极小（< 中位 30%）几乎必然是残块；60% 以下则需同时贴边才算
  const tinyLimit = typicalSize * 0.3;
  const edgeLimit = typicalSize * 0.6;

  const kept = [];
  groups.forEach((group) => {
    if (group.length <= mode) {
      kept.push(...group);
      return;
    }

    const sorted = [...group].sort((a, b) => (layout === 'vertical' ? a.y - b.y : a.x - b.x));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const sizeOf = (box) => (layout === 'vertical' ? box.height : box.width);
    // 极小的一律视为残块（可能在中间）；稍小但贴边的也视为残块
    // 带 simpleStroke 标记的是「一」这类简单笔画字，不应作为残块裁剪
    const tiny = sorted.filter((box) => sizeOf(box) < tinyLimit && !box.simpleStroke);
    const edgeCandidates = [first, last].filter(
      (box) => sizeOf(box) < edgeLimit && !tiny.includes(box)
    );
    const candidates = [...tiny, ...edgeCandidates];

    const excess = group.length - mode;
    if (candidates.length > 0) {
      const drop = new Set(candidates.slice(0, excess));
      sorted.forEach((box) => {
        if (!drop.has(box)) kept.push(box);
      });
    } else {
      // 没有贴边残块的多字列：保留原样（例如一列本来就比别人多一个字）
      kept.push(...sorted);
    }
  });

  return kept.length > 0 ? kept : boxes;
};

/**
 * 合并「同一字被切开的部件」
 *
 * 无格自由书写时，左右结构的字（如「氵」+主体）中间会有明显空隙，
 * 投影会把它们切成两块。判据是空隙宽度相对相邻块平均宽度的比例：
 * 实测同一字的部件间隙约 0.14~0.15，独立字之间 >=0.34，取 0.25 作分界。
 *
 * 补充判据（仅竖排、已知列宽时生效）：
 * 上半是「一横」、下半是主体（如「石」「百」「夏」）的字，横与主体之间
 * 只有细撇相连，投影会把它判成字间空白，形成「极扁块 + 主体块」。
 * 原判据的间隙上限按「两块平均高度」算，扁块把基准拉低，导致合并不了
 * （实测：扁块 34、主体 97、间隙 36，上限仅 16.4）。
 * 因此改用列宽作基准，但必须同时满足「合并后总高仍不超过一个字高」，
 * 否则会把上一个字与下一个字的起笔横误并成一个字。
 */
export const mergeSplitGlyphs = (bands, threshold = 0.25, referenceSize = 0) => {
  if (bands.length < 2) return bands;
  const merged = [{ ...bands[0] }];

  for (let i = 1; i < bands.length; i += 1) {
    const previous = merged[merged.length - 1];
    const current = bands[i];
    const gap = current.start - previous.end;
    const previousSize = previous.end - previous.start;
    const currentSize = current.end - current.start;
    const averageSize = (previousSize + currentSize) / 2;

    // 只有「至少一块明显小于正常字」时才可能是一个字被切开
    const smaller = Math.min(previousSize, currentSize);
    const normalSize = referenceSize > 0 ? referenceSize : averageSize;
    const looksLikeFragment = smaller < normalSize * 0.75;

    const defaultMerge = looksLikeFragment && averageSize > 0 && gap < averageSize * threshold;

    // 原判据合不了、且列宽已知时，只 rescue「扁部件 + 主体」这一种情形。
    // 四重限制：非简单笔画字 / 至少一块明显偏扁 / 间隙小于列宽 25% /
    // 合并后总高不超过列宽 1.3 倍。任何一条不满足都保持原样，避免误合并。
    let flatFragmentMerge = false;
    if (!defaultMerge && referenceSize > 0 && !previous.simpleStroke && !current.simpleStroke) {
      const totalHeight = current.end - previous.start;
      flatFragmentMerge =
        smaller < referenceSize * 0.45 &&
        gap >= 0 && gap < referenceSize * threshold &&
        totalHeight <= referenceSize * 1.3;
    }

    if (defaultMerge || flatFragmentMerge) {
      previous.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
};

/**
 * 拆分过高的字块（竖排专用）
 *
 * 竖排时一个字的高度应接近列宽（实测比值 0.7~1.1）。
 * 若某块明显高于列宽（如 1.44 倍），说明上下两个字粘连，
 * 应按列宽等分拆开。
 */
// 正常汉字的高度可以略大于宽度（实测上限约 1.44），
// 而两字粘连通常在 2.0 以上，因此阈值取 1.7
export const splitTallGlyphs = (bands, referenceSize, maxRatio = 1.7) => {
  if (bands.length === 0 || referenceSize <= 0) return bands;

  const result = [];
  bands.forEach((band) => {
    const size = band.end - band.start;
    const limit = referenceSize * maxRatio;
    if (size <= limit) {
      result.push(band);
      return;
    }
    const parts = Math.max(2, Math.round(size / referenceSize));
    const step = size / parts;
    for (let i = 0; i < parts; i += 1) {
      result.push({
        start: Math.round(band.start + i * step),
        end: Math.round(band.start + (i + 1) * step)
      });
    }
  });
  return result;
};

/**
 * 碎片归并：把明显偏小的块合并到相邻块（比关键词合并更稳健）
 *
 * 竖排时一个字的高度应接近列宽，若某块高度远小于列宽，
 * 说明它是被笔画间隙切开的部件，应与相邻块合并。
 */
export const absorbFragments = (bands, referenceSize, tolerance = 0.7) => {
  if (bands.length < 2 || referenceSize <= 0) return bands;

  const sizes = bands.map((band) => band.end - band.start);
  const sorted = [...sizes].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.min(referenceSize, typical) * tolerance;

  const merged = bands.map((band) => ({ ...band }));
  // 从小块开始，向相邻较小间隔的一侧合并
  let index = 0;
  while (index < merged.length && merged.length > 1) {
    const band = merged[index];
    const size = band.end - band.start;
    if (size >= threshold || merged.length === 1) {
      index += 1;
      continue;
    }
    const prev = merged[index - 1];
    const next = merged[index + 1];
    const gapPrev = prev ? band.start - prev.end : Infinity;
    const gapNext = next ? next.start - band.end : Infinity;

    if (gapPrev <= gapNext && prev) {
      prev.end = band.end;
      merged.splice(index, 1);
      index = Math.max(0, index - 1);
    } else if (next) {
      next.start = band.start;
      merged.splice(index, 1);
    } else {
      index += 1;
    }
  }
  return merged;
};

/**
 * 检测格线（列格 / 行格 / 全格）
 *
 * 思路：格线是「比局部背景略暗的细线」，先得到 faint 掩码，
 * 再做投影找强峰，最后从峰里提取最长等差序列（格距应高度一致）。
 */
export const detectGridLines = (faint, ink, width, height) => {
  const colRatio = new Uint32Array(width);
  const rowRatio = new Uint32Array(height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    let rowCount = 0;
    for (let x = 0; x < width; x += 1) {
      if (faint[rowStart + x]) {
        colRatio[x] += 1;
        rowCount += 1;
      }
    }
    rowRatio[y] = rowCount;
  }

  const pickPeaks = (counts, total) => {
    const ratios = new Float32Array(counts.length);
    let max = 0;
    for (let i = 0; i < counts.length; i += 1) {
      ratios[i] = counts[i] / total;
      if (ratios[i] > max) max = ratios[i];
    }
    if (max <= 0) return [];
    const threshold = Math.max(max * 0.25, 0.12);
    const peaks = [];
    let index = 0;
    while (index < ratios.length) {
      if (ratios[index] < threshold) {
        index += 1;
        continue;
      }
      let end = index;
      let best = index;
      while (end < ratios.length && ratios[end] >= threshold) {
        if (ratios[end] > ratios[best]) best = end;
        end += 1;
      }
      peaks.push(best);
      index = end + 10;
    }
    return peaks;
  };

  // 从候选线中找最长等差序列
  const longestArithmetic = (peaks, minStep) => {
    if (peaks.length < 3) return null;
    let best = null;
    for (let i = 0; i < peaks.length; i += 1) {
      for (let j = i + 1; j < peaks.length; j += 1) {
        const step = peaks[j] - peaks[i];
        if (step < minStep) continue;
        const sequence = [peaks[i], peaks[j]];
        const tolerance = Math.max(4, step * 0.06);
        let expected = peaks[j] + step;
        for (let k = j + 1; k < peaks.length; k += 1) {
          if (Math.abs(peaks[k] - expected) <= tolerance) {
            sequence.push(peaks[k]);
            expected = peaks[k] + step;
          }
        }
        if (!best || sequence.length > best.sequence.length) {
          best = { sequence, step };
        }
      }
    }
    return best && best.sequence.length >= 3 ? best : null;
  };

  const vertical = longestArithmetic(pickPeaks(colRatio, height), Math.round(width * 0.06));
  const horizontal = longestArithmetic(pickPeaks(rowRatio, width), Math.round(height * 0.06));

  const hasVertical = Boolean(vertical);
  const hasHorizontal = Boolean(horizontal);
  const kind = hasVertical && hasHorizontal ? 'full' : hasVertical ? 'column' : hasHorizontal ? 'row' : 'none';

  return {
    kind,
    vertical: vertical ? vertical.sequence : [],
    horizontal: horizontal ? horizontal.sequence : [],
    verticalStep: vertical ? vertical.step : 0,
    horizontalStep: horizontal ? horizontal.step : 0
  };
};

/**
 * 由格线生成单元格字框
 * 竖排阅读顺序：从右往左、自上而下
 */
export const boxesFromGridLines = (grid, layout = 'vertical') => {
  const { vertical, horizontal } = grid;
  if (vertical.length < 2 || horizontal.length < 2) return [];

  const boxes = [];
  for (let r = 0; r < horizontal.length - 1; r += 1) {
    for (let c = 0; c < vertical.length - 1; c += 1) {
      boxes.push({
        x: vertical[c],
        y: horizontal[r],
        width: vertical[c + 1] - vertical[c],
        height: horizontal[r + 1] - horizontal[r]
      });
    }
  }

  const cellWidth =
    (vertical[vertical.length - 1] - vertical[0]) / Math.max(1, vertical.length - 1);
  sortByReadingOrder(boxes, layout, cellWidth);

  return boxes;
};

/**
 * 从已构建的墨迹 / 格线掩码切分单字（同步纯计算，不依赖 DOM）。
 * 由 segmentCharacters 与 golden 回归测试共用，保证夹具测的是真实切分链路。
 * 参数语义与 segmentCharacters 的 options 一致，只是把图像解码前置到调用方。
 * @returns {{boxes: Array, layout: string, columns: number, scale: number, failed: boolean, strategy?: string}}
 */
export const segmentFromMasks = (
  ink,
  faint,
  {
    width: W,
    height: H,
    scale = 1,
    imageWidth = W / scale,
    imageHeight = H / scale,
    layout: forcedLayout = 'auto',
    hasGrid = false
  } = {}
) => {
  const gapCol = Math.max(2, Math.round(W * GAP_RATIO));
  const gapRow = Math.max(2, Math.round(H * GAP_RATIO));
  const minSizeCol = Math.max(2, Math.round(W * MIN_SIZE_RATIO));
  const minSizeRow = Math.max(2, Math.round(H * MIN_SIZE_RATIO));

  const colProfile = projectColumns(ink, W, H);

  // 列带先用投影找，再用字距把粘连的多列拆开
  const rawColBands = findBands(colProfile, {
    relInk: INK_RATIO,
    minGap: gapCol,
    minSize: minSizeCol
  });
  // 仅双联 / 条幅形态放宽上限，其余版式保持 0.4W（避免锁到缩略图网格等伪周期）
  const maxPitchRatio = needsWidePitchSearch(rawColBands, W) ? 0.55 : 0.4;
  const { pitch } = estimatePitch(colProfile, 0.08, maxPitchRatio);
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
  // 字帖一律按竖排处理（中文书法几乎都是竖排，自上而下、从右往左）
  const detectLayout = () => 'vertical';

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
    // 遍历顺序无关紧要：最终顺序由 sortByReadingOrder 统一决定
    colBands.forEach((col) => {
      const columnWidth = col.end - col.start;
      // 注意：竖排的列内是按「高度」切字，而 pitch 是横向周期，不能用于此处的等分
      const charBands = splitTallGlyphs(
        mergeSplitGlyphs(
          recoverFlatStrokes(
            ink,
            W,
            col.start,
            col.end,
            findBands(projectRows(ink, W, H, col.start, col.end), {
              relInk: INK_RATIO,
              minGap: gapRow,
              minSize: minSizeRow
            }),
            minSizeRow,
            gapRow
          ),
          0.25,
          columnWidth
        ),
        columnWidth
      );
      columnDetail.push({ width: col.end - col.start, bands: charBands.length, sizes: charBands.map((b) => b.end - b.start) });
      charBands.forEach((band, bandIndex) => {
        // 本字在「自己这一行范围内」到左右相邻墨迹的实际空隙
        // 这一侧到最近一段「非本字墨迹」的空白宽度
        // 直接量「紧邻边界的空白」；若边界处就是墨迹，说明字已贴着边界，扩展受限
        const scanGap = (fromX, step) => {
          let x = fromX;
          let blank = 0;
          while (x >= 0 && x < W) {
            let has = false;
            for (let y = band.start; y < band.end; y += 1) {
              if (ink[y * W + x]) { has = true; break; }
            }
            if (has) break;
            blank += 1;
            x += step;
          }
          if (x < 0 || x >= W) return Infinity;
          return blank;
        };

        const gapLeft = scanGap(col.start - 1, -1);
        const gapRight = scanGap(col.end, 1);
        // 左右各自最多扩到「相邻墨迹的一半」，两边加起来不会重叠
        const horizontalGap = Math.min(gapLeft, gapRight);

        // 1) 先按字自身墨迹取宽，避免略宽的字被列边界裁掉
        const measured = measureGlyphHorizontally(
          ink,
          W,
          band.start,
          band.end,
          col.start,
          col.end,
          0.6,
          horizontalGap
        );
        const boxLeft = Math.min(col.start, measured.left);
        const boxRight = Math.max(col.end, measured.right);


        // 本字到上下相邻字的实际空隙（用于限制垂直扩展）
        const prevBand = charBands[bandIndex - 1];
        const nextBand = charBands[bandIndex + 1];
        const gapUp = prevBand ? band.start - prevBand.end : Infinity;
        const gapDown = nextBand ? nextBand.start - band.end : Infinity;

        // 2) 再在这个宽度内取真实上下边界，避免笔画探出被裁
        const vertical = measureGlyphVertically(
          ink,
          W,
          H,
          boxLeft,
          boxRight,
          band.start,
          band.end,
          0.6,
          gapUp,
          gapDown
        );
        const boxTop = Math.min(band.start, vertical.top);
        const boxBottom = Math.max(band.end, vertical.bottom);

        const sourceBox = toSource({
          x: boxLeft,
          y: boxTop,
          width: boxRight - boxLeft,
          height: boxBottom - boxTop
        });
        // 保留「简单笔画字」标记（toSource 只转坐标，标记需手动带上），
        // 供 normalizeColumnCounts 裁剪时豁免
        if (band.simpleStroke) sourceBox.simpleStroke = true;
        boxes.push(sourceBox);
      });
    });
    // 竖排的高度拆分已由 splitTallGlyphs 按列宽完成，这里不再重复按中位值拆分
    sortByReadingOrder(boxes, 'vertical', median(colBands.map((band) => band.end - band.start)) / scale);
  }

  // 有格字帖：格线本身就是最可靠的分隔，直接用它生成单元格
  let gridInfo = null;
  if (hasGrid) {
    gridInfo = detectGridLines(faint, ink, W, H);
    const gridLayout = layout;
    const gridBoxes = boxesFromGridLines(gridInfo, gridLayout).map(toSource);
    if (gridBoxes.length > 0) {
      return {
        boxes: gridBoxes,
        layout: gridLayout,
        columns: Math.max(0, gridInfo.vertical.length - 1),
        strategy: 'grid-lines',
        gridKind: gridInfo.kind,
        gridStep: { x: gridInfo.verticalStep / scale, y: gridInfo.horizontalStep / scale },
        scale,
        failed: false,
        charSize: {
          width: median(gridBoxes.map((box) => box.width)),
          height: median(gridBoxes.map((box) => box.height))
        }
      };
    }
  }

  // 过滤异常块（过大 = 整页被当成一个字；过小 = 噪点）
  const maxW = (W / scale) * MAX_SIZE_RATIO;
  const maxH = (H / scale) * MAX_SIZE_RATIO;
  let usable = boxes.filter((box) => box.width <= maxW && box.height <= maxH && box.width > 4 && box.height > 4);

  // 过滤碎片：明显小于中位字块的（通常是贴边被截断的半行或噪点）
  //
  // 关键：不能只看高度。笔画简单的字（如「一」）墨迹高度天然只有正常字的
  // 1/4 左右，但它的**宽度是正常的**。真正的碎片（贴边截断的半行、噪点）
  // 通常宽高都明显偏小。
  // 因此：高度偏小但宽度正常的，判定为「笔画简单的字」并保留。
  if (usable.length >= 5) {
    // 用 75 分位而不是中位数作为「正常字」基准。
    // 原因：印章、装饰纹样会切成大量碎块（实测 t8 有 129/149 个是 12x16 碎块），
    // 把中位数拉到碎块的尺寸，导致碎片过滤完全失效。
    // 75 分位落在正常字一侧，不受碎块数量影响。
    const percentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };
    // 90 分位：碎块占比极高时（如 129/149）75 分位仍落在碎块区间
    const medianW = percentile(usable.map((box) => box.width), 0.9);
    const medianH = percentile(usable.map((box) => box.height), 0.9);
    // 图片尺寸（原图坐标），用于判断「贴边」
    const imageW = W / scale;
    const imageH = H / scale;
    const edgeMargin = medianH * 0.15;

    usable = usable.filter((box) => {
      if (box.width < medianW * 0.35) return false;        // 太窄：碎片/噪点
      if (box.height >= medianH * 0.45) return true;       // 高度正常：保留

      // 高度偏小：只有「宽度接近正常字宽」才是笔画简单的字（如「一」）。
      if (box.width < medianW * 0.6) return false;

      // 但贴着图片上下边缘的矮块仍是残块（页面被截断的半行）。
      // 实测：密集字帖底部常出现 宽比 1.0、高比 0.27 的贴边残块，
      // 只按宽度判断会把它误当成「一」。
      const touchesTop = box.y <= edgeMargin;
      const touchesBottom = box.y + box.height >= imageH - edgeMargin;
      if (touchesTop || touchesBottom) return false;

      return true;
    });
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
    const ranges = colBands.map((band) => ({ start: band.start / scale, end: band.end / scale }));
    usable = normalizeColumnCounts(usable, ranges, layout);
    // 归一过程会按分组重建数组，这里恢复阅读顺序
    const columnWidth = median(colBands.map((band) => band.end - band.start)) / scale;
    sortByReadingOrder(usable, layout, columnWidth);
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
    // 原图尺寸：调用方用它判断缓存是否仍与当前图片匹配（由入参传入）
    imageWidth,
    imageHeight,
    failed: false,
    charSize: {
      width: median(usable.map((box) => box.width)),
      height: median(usable.map((box) => box.height))
    }
  };
};

/**
 * 主入口：把整幅字帖切成一个个单字
 * 只负责图像解码与掩码构建，计算交给 segmentFromMasks
 * @returns {Promise<{boxes: Array, layout: string, columns: number, scale: number, failed: boolean, reason?: string}>}
 */
export const segmentCharacters = async (imageSrc, options = {}) => {
  const { maxSize = MAX_ANALYSIS_SIZE } = options;
  const img = await loadImageElement(imageSrc);
  const { width, height, ink, faint, scale } = buildInkMask(img, maxSize);
  return segmentFromMasks(ink, faint, {
    width,
    height,
    scale,
    // 必须直接取 img 的真实尺寸 —— 用 width/scale 反推会有 1~2px 舍入误差，
    // 导致与 naturalWidth 严格相等判断失败、缓存永不命中。
    imageWidth: img.naturalWidth || img.width,
    imageHeight: img.naturalHeight || img.height,
    layout: options.layout,
    hasGrid: options.hasGrid
  });
};
