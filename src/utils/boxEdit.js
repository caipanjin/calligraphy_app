/**
 * 切分框的编辑操作（纯函数，便于测试）
 *
 * 自动切分不可能 100% 准确，因此提供手动修正：
 * 删掉多余的框、把被切开的一个字合并回去。
 */

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
 * 找到与某个框最邻近的框（按中心距离）
 * 用于「与相邻框合并」
 */
/**
 * 在指定位置新增一个框（用于补切分漏掉的字）
 *
 * 会按阅读顺序插入到合适的位置，避免新框排到末尾导致「下一字」跳转错乱。
 * 竖排规则：列从右到左（x 大的在前），列内从上到下（y 小的在前）。
 *
 * @param {Array} boxes 现有框
 * @param {{x,y,width,height}} box 新框（原图坐标）
 * @param {boolean} vertical 是否竖排（本项目恒为 true）
 */
export const addBox = (boxes, box, vertical = true) => {
  const next = [...boxes, box];

  next.sort((a, b) => {
    if (vertical) {
      // 同一列判定：中心 x 差距小于半列宽
      const aCenter = a.x + a.width / 2;
      const bCenter = b.x + b.width / 2;
      const tolerance = Math.max(a.width, b.width) * 0.5;
      if (Math.abs(aCenter - bCenter) > tolerance) {
        // 列不同：x 大的（右边）先读
        return bCenter - aCenter;
      }
      // 同列：y 小的（上方）先读
      return a.y - b.y;
    }
    // 横排：y 小的先读，同行内 x 小的先读
    const aCenterY = a.y + a.height / 2;
    const bCenterY = b.y + b.height / 2;
    const tolerance = Math.max(a.height, b.height) * 0.5;
    if (Math.abs(aCenterY - bCenterY) > tolerance) return aCenterY - bCenterY;
    return a.x - b.x;
  });

  return next;
};

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

/**
 * 在某个框的基础上「上下拆分」（把一个过大的框拆成两个）
 * 竖排时按纵向拆分
 */
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
