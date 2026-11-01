/**
 * 竖排书法的字符导航。
 *
 * 书法字帖通常自上而下、自右向左排列，因此“下一字”优先向下走一列，
 * 走到列底再左移一列；“上一字”则是反向。
 *
 * 这里把原 CharacterSelector 里嵌在组件中的递归逻辑提取为纯函数，便于测试。
 */

const HIDDEN = Object.freeze({ x: -1, y: -1 });

const getContext = ({ viewBox, width, height }) => ({
  charWidth: viewBox.width,
  charHeight: viewBox.height,
  imageWidth: width,
  imageHeight: height
});

const isHiddenPosition = (position) => position.x === -1 && position.y === -1;

export const HIDDEN_POSITION = HIDDEN;
export { isHiddenPosition };

/**
 * 下一个字符的位置
 * @param {Object} selectedCharacter - 含 viewBox / width / height 的字符对象
 * @param {number} x - 当前 viewBox 的 x
 * @param {number} y - 当前 viewBox 的 y
 * @param {number} step - 前进几个字符
 */
export const getNextCharacterPosition = (selectedCharacter, x, y, step = 1) => {
  const { charWidth, charHeight, imageWidth, imageHeight } = getContext(selectedCharacter);

  let currentX = x;
  let currentY = y;

  for (let i = 0; i < step; i += 1) {
    let nextX = currentX;
    let nextY = currentY + charHeight;

    // 走到底部：换到左一列的列首
    if (nextY >= imageHeight) {
      nextX -= charWidth;
      nextY = 0;
    }

    if (!(nextX + charWidth / 2 >= 0 && nextY < imageHeight)) {
      return HIDDEN;
    }

    // 目标位置显示不全时，退到上一列的列首
    if (imageWidth - nextX < charWidth / 2 || imageHeight - nextY < charHeight / 2) {
      nextX -= charWidth;
      nextY = 0;
      if (
        !(
          nextX + charWidth / 2 >= 0 &&
          imageWidth - nextX >= charWidth / 2 &&
          imageHeight - nextY >= charHeight / 2
        )
      ) {
        return HIDDEN;
      }
    }

    currentX = nextX;
    currentY = nextY;
  }

  return { x: currentX, y: currentY };
};

/**
 * 上一个字符的位置
 */
export const getPreviousCharacterPosition = (selectedCharacter, x, y, step = 1) => {
  const { charWidth, charHeight, imageWidth, imageHeight } = getContext(selectedCharacter);

  let currentX = x;
  let currentY = y;

  for (let i = 0; i < step; i += 1) {
    let nextX = currentX;
    let nextY = currentY - charHeight;

    // 走到顶部：换到右一列的列尾
    if (nextY + charHeight / 2 < 0) {
      nextX += charWidth;
      nextY = imageHeight - charHeight;
    }

    if (!(nextX < imageWidth && nextY + charHeight / 2 >= 0)) {
      return HIDDEN;
    }

    // 目标位置显示不全时，转到下一列的列首
    if (imageWidth - nextX < charWidth / 2 || imageHeight - nextY < charHeight / 2) {
      nextX += charWidth;
      nextY = 0;
      if (
        !(
          nextX < imageWidth &&
          imageWidth - nextX >= charWidth / 2 &&
          imageHeight - nextY >= charHeight / 2
        )
      ) {
        return HIDDEN;
      }
    }

    currentX = nextX;
    currentY = nextY;
  }

  return { x: currentX, y: currentY };
};

/** 计算当前字符前后的预览位置（前 2、前 1、当前、后 1、后 2） */
export const getCharacterNeighborhood = (selectedCharacter) => {
  const { x, y } = selectedCharacter.viewBox;
  return [
    getPreviousCharacterPosition(selectedCharacter, x, y, 2),
    getPreviousCharacterPosition(selectedCharacter, x, y, 1),
    { x, y },
    getNextCharacterPosition(selectedCharacter, x, y, 1),
    getNextCharacterPosition(selectedCharacter, x, y, 2)
  ];
};
