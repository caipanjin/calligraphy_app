/**
 * 切分框的编辑操作（纯函数，便于测试）
 *
 * 自动切分不可能 100% 准确，因此提供手动修正：
 * 删掉多余的框、把被切开的一个字合并回去，以及逐字微调位置与大小。
 *
 * 设计边界（重要）：书法无格字帖里各列字数、字距、字高都可能不同，
 * 因此这里所有操作都只作用于「本列」，不做任何跨列对齐或等距推断。
 */

/** 框的最小边长，防止拖拽时把框压成一条线 */
export const MIN_BOX_SIZE = 8;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const medianOf = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * 按阅读顺序排列（竖排：列从右到左、列内从上到下）
 * 与 addBox 里原先用的是同一套比较规则，抽出来供「重切本段」后复原顺序。
 */
export const sortBoxesByReadingOrder = (boxes, vertical = true) =>
  [...boxes].sort((a, b) => {
    if (vertical) {
      const aCenter = a.x + a.width / 2;
      const bCenter = b.x + b.width / 2;
      const tolerance = Math.max(a.width, b.width) * 0.5;
      if (Math.abs(aCenter - bCenter) > tolerance) return bCenter - aCenter;
      return a.y - b.y;
    }
    const aCenterY = a.y + a.height / 2;
    const bCenterY = b.y + b.height / 2;
    const tolerance = Math.max(a.height, b.height) * 0.5;
    if (Math.abs(aCenterY - bCenterY) > tolerance) return aCenterY - bCenterY;
    return a.x - b.x;
  });

/** 删除指定索引的框 */
export const removeBox = (boxes, index) => {
  if (index < 0 || index >= boxes.length) return boxes;
  return boxes.filter((_, i) => i !== index);
};

/** 合并两个相邻框为一个外接框 */
export const mergeBoxes = (boxes, indexA, indexB) => {
  if (indexA < 0 || indexB < 0 || indexA >= boxes.length || indexB >= boxes.length) return boxes;
  if (indexA === indexB) return boxes;

  const a = boxes[indexA];
  const b = boxes[indexB];
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const merged = {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  };

  const keepIndex = Math.min(indexA, indexB);
  const dropIndex = Math.max(indexA, indexB);
  const result = boxes.map((box) => ({ ...box }));
  result[keepIndex] = merged;
  result.splice(dropIndex, 1);
  return result;
};

/**
 * 按 x 中心把框聚类成「列」，返回 [{ anchor, indices }]（从右到左）。
 * indices 是原数组下标、列内按 y 从上到下排好，方便只操作本列。
 *
 * 用第一框的中心作锚点而不是滚动均值，避免一列里字宽不一导致聚类漂移。
 */
export const groupBoxesByColumn = (boxes) => {
  if (!Array.isArray(boxes) || boxes.length === 0) return [];
  const tolerance = Math.max(MIN_BOX_SIZE, medianOf(boxes.map((b) => b.width)) * 0.5);
  const items = boxes
    .map((box, index) => ({ index, cx: box.x + box.width / 2 }))
    .sort((a, b) => b.cx - a.cx);

  const columns = [];
  items.forEach((item) => {
    const column = columns.find((c) => Math.abs(c.anchor - item.cx) <= tolerance);
    if (column) column.indices.push(item.index);
    else columns.push({ anchor: item.cx, indices: [item.index] });
  });
  columns.forEach((column) => {
    column.indices.sort((a, b) => boxes[a].y - boxes[b].y);
  });
  return columns;
};

/** 整体平移一个框，钳制在图片范围内；索引与顺序保持不变 */
export const moveBox = (boxes, index, dx, dy, bounds = {}) => {
  const box = boxes[index];
  if (!box || !Number.isFinite(dx) || !Number.isFinite(dy)) return boxes;
  const maxW = Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const maxH = Number.isFinite(bounds.height) ? bounds.height : Infinity;
  const next = {
    ...box,
    x: Math.round(clamp(box.x + dx, 0, Math.max(0, maxW - box.width))),
    y: Math.round(clamp(box.y + dy, 0, Math.max(0, maxH - box.height)))
  };
  if (next.x === box.x && next.y === box.y) return boxes;
  return boxes.map((item, i) => (i === index ? next : item));
};

/**
 * 拉伸某一条边 / 某一个角，另一边保持不动。
 * edge 为 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'。
 * 每个字高度可以完全不同，因此不做任何「统一字高」的处理。
 */
export const resizeBox = (boxes, index, edge, dx, dy, bounds = {}) => {
  const box = boxes[index];
  if (!box || !Number.isFinite(dx) || !Number.isFinite(dy)) return boxes;
  const maxW = Number.isFinite(bounds.width) ? bounds.width : Infinity;
  const maxH = Number.isFinite(bounds.height) ? bounds.height : Infinity;

  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (edge.includes('w')) left = clamp(left + dx, 0, right - MIN_BOX_SIZE);
  if (edge.includes('e')) right = clamp(right + dx, left + MIN_BOX_SIZE, maxW);
  if (edge.includes('n')) top = clamp(top + dy, 0, bottom - MIN_BOX_SIZE);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + MIN_BOX_SIZE, maxH);

  const next = {
    ...box,
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  };
  if (next.width === box.width && next.height === box.height &&
      next.x === box.x && next.y === box.y) return boxes;
  return boxes.map((item, i) => (i === index ? next : item));
};

/**
 * 拖动「本列公共边界切线」：第 boundaryIndex 与下一个框的交界移到 y。
 * 上框变高/变矮、下框同步上移/下移，天然不重叠也不留缝；
 * 行书里字可以贴得很近甚至笔画穿插，这个模型比等距重排贴合得多。
 */
export const setColumnBoundary = (boxes, indices, boundaryIndex, y) => {
  if (!Array.isArray(indices) || boundaryIndex < 0 || boundaryIndex >= indices.length - 1) return boxes;
  if (!Number.isFinite(y)) return boxes;
  const upperIndex = indices[boundaryIndex];
  const lowerIndex = indices[boundaryIndex + 1];
  const upper = boxes[upperIndex];
  const lower = boxes[lowerIndex];
  if (!upper || !lower) return boxes;

  const minY = upper.y + MIN_BOX_SIZE;
  const maxY = lower.y + lower.height - MIN_BOX_SIZE;
  if (maxY < minY) return boxes;
  const cut = Math.round(clamp(y, minY, maxY));

  return boxes.map((box, i) => {
    if (i === upperIndex) return { ...upper, height: cut - upper.y };
    if (i === lowerIndex) return { ...lower, y: cut, height: lower.y + lower.height - cut };
    return box;
  });
};

/** 取一组框在本列的公共边界位置，作为切线的初始显示位置 */
export const columnBoundaries = (boxes, indices) => {
  if (!Array.isArray(indices) || indices.length < 2) return [];
  const cuts = [];
  for (let i = 0; i < indices.length - 1; i += 1) {
    const upper = boxes[indices[i]];
    const lower = boxes[indices[i + 1]];
    if (!upper || !lower) continue;
    cuts.push(Math.round((upper.y + upper.height + lower.y) / 2));
  }
  return cuts;
};

/**
 * 用用户确认过的切线把本列的一段重新切成 N+1 个框。
 * 只替换 indices 指向的框，x / 宽度取这一段的中位数（不受异常框影响），
 * 最后按阅读顺序复原。框数会变，调用处需要清练习记录。
 */
export const resegmentColumnRange = (boxes, indices, boundaries, vertical = true) => {
  const targets = [...new Set(indices || [])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < boxes.length)
    .sort((a, b) => a - b);
  if (targets.length === 0 || !Array.isArray(boundaries) || boundaries.length === 0) return boxes;

  const refs = targets.map((i) => boxes[i]);
  const x = Math.round(medianOf(refs.map((b) => b.x)));
  const width = Math.round(medianOf(refs.map((b) => b.width)));
  const top = Math.min(...refs.map((b) => b.y));
  const bottom = Math.max(...refs.map((b) => b.y + b.height));

  const cuts = [];
  [...new Set(boundaries.map((v) => Math.round(v)))]
    .filter((v) => Number.isFinite(v) && v > top + MIN_BOX_SIZE && v < bottom - MIN_BOX_SIZE)
    .sort((a, b) => a - b)
    .forEach((v) => {
      if (cuts.length === 0 || v - cuts[cuts.length - 1] >= MIN_BOX_SIZE) cuts.push(v);
    });
  if (cuts.length === 0) return boxes;

  const edges = [top, ...cuts, bottom];
  const replacement = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    replacement.push({ x, y: edges[i], width, height: edges[i + 1] - edges[i] });
  }
  const rest = boxes.filter((_, i) => !targets.includes(i));
  return sortBoxesByReadingOrder([...rest, ...replacement], vertical);
};

/**
 * 区域二次切分：从手绘区域的候选切线里挑出「够宽的字间距」作为默认切线。
 *
 * 拖选题款小字时，字内笔画间隙也会被行投影当成空白（实测一条题款列里
 * 相邻候选线只隔 44~47px，而小字本身高约 60~100px）；若把全部候选线
 * 都应用，会把一个字切成两三块。因此以区域宽度（≈单字宽）为尺度设下限，
 * 贪心保留间距足够的线。这里只决定「默认勾选哪些」，用户仍可自行增减。
 *
 * @param {number[]} boundaries 候选切线（原图 y 坐标）
 * @param {{y:number,width:number,height:number}} region 手绘区域
 * @param {number} ratio 最小字间距 / 区域宽度，默认 0.55
 * @returns {number[]} 默认选中的切线（升序、去重）
 */
export const pickRegionCuts = (boundaries, region, ratio = 0.55) => {
  if (!Array.isArray(boundaries) || !region || !(region.width > 0) || !(region.height > 0)) return [];
  const minGap = Math.max(MIN_BOX_SIZE, Math.round(region.width * ratio));
  const top = region.y;
  const bottom = region.y + region.height;
  const sorted = [...new Set(
    boundaries
      .map((value) => Math.round(value))
      .filter((value) => Number.isFinite(value) && value > top + minGap && value < bottom - minGap)
  )].sort((a, b) => a - b);
  const cuts = [];
  sorted.forEach((value) => {
    if (cuts.length === 0 || value - cuts[cuts.length - 1] >= minGap) cuts.push(value);
  });
  return cuts;
};

/** 把某个值吸附到最近的候选位置（未命中容差时原样返回） */
export const snapValue = (value, candidates, tolerance = 8) => {
  if (!Number.isFinite(value) || !Array.isArray(candidates)) return value;
  let best = value;
  let distance = tolerance + 1;
  candidates.forEach((candidate) => {
    const d = Math.abs(candidate - value);
    if (d <= tolerance && d < distance) {
      distance = d;
      best = candidate;
    }
  });
  return best;
};

/**
 * 在指定位置新增一个框（用于补切分漏掉的字）
 *
 * 会按阅读顺序插入到合适的位置，避免新框排到末尾导致「下一字」跳转错乱。
 * 竖排规则：列从右到左（x 大的在前），列内从上到下（y 小的在前）。
 */
export const addBox = (boxes, box, vertical = true) =>
  sortBoxesByReadingOrder([...boxes, box], vertical);

export const findNearestBoxIndex = (boxes, index) => {
  if (index < 0 || index >= boxes.length || boxes.length < 2) return -1;
  const target = boxes[index];
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;

  let bestIndex = -1;
  let bestDistance = Infinity;
  boxes.forEach((box, i) => {
    if (i === index) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // 竖排为主：纵向距离权重更高，倾向合并上下相邻的框
    const distance = Math.hypot(cx - targetX, (cy - targetY) * 1.6);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  });
  return bestIndex;
};

/** 在某个框的基础上「上下拆分」（把一个过大的框拆成两个） */
export const splitBox = (boxes, index, vertical = true) => {
  const box = boxes[index];
  if (!box) return boxes;

  const result = boxes.map((item) => ({ ...item }));
  if (vertical) {
    const half = box.height / 2;
    result[index] = { ...box, height: half };
    result.splice(index + 1, 0, { ...box, y: box.y + half, height: half });
  } else {
    const half = box.width / 2;
    result[index] = { ...box, width: half };
    result.splice(index + 1, 0, { ...box, x: box.x + half, width: half });
  }
  return result;
};
