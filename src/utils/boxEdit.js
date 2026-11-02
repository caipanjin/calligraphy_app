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
