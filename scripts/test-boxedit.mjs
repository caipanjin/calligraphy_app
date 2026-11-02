/** 切分框编辑操作的单元测试 */
import assert from 'node:assert/strict';
import { removeBox, mergeBoxes, splitBox, findNearestBoxIndex } from '../src/utils/boxEdit.js';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    process.exitCode = 1;
  }
};

const boxes = [
  { x: 0, y: 0, width: 100, height: 100 },
  { x: 0, y: 120, width: 100, height: 80 },
  { x: 0, y: 220, width: 100, height: 100 }
];

check('删除指定框', () => {
  const out = removeBox(boxes, 1);
  assert.equal(out.length, 2);
  assert.equal(out[1].y, 220);
});

check('删除越界索引不改变数组', () => {
  assert.equal(removeBox(boxes, 99).length, 3);
});

check('合并两个相邻框为外接框', () => {
  const out = mergeBoxes(boxes, 0, 1);
  assert.equal(out.length, 2);
  assert.equal(out[0].y, 0);
  assert.equal(out[0].height, 200); // 0..200
});

check('合并同一索引无效果', () => {
  assert.equal(mergeBoxes(boxes, 1, 1).length, 3);
});

check('竖排拆分：按高度对半', () => {
  const out = splitBox(boxes, 0, true);
  assert.equal(out.length, 4);
  assert.equal(out[0].height, 50);
  assert.equal(out[1].y, 50);
});

check('横排拆分：按宽度对半', () => {
  const out = splitBox(boxes, 0, false);
  assert.equal(out.length, 4);
  assert.equal(out[0].width, 50);
  assert.equal(out[1].x, 50);
});

check('查找最近邻框：优先上下相邻', () => {
  const neighbor = findNearestBoxIndex(boxes, 1);
  assert.ok(neighbor === 0 || neighbor === 2, `neighbor=${neighbor}`);
});

check('只有一个框时无最近邻', () => {
  assert.equal(findNearestBoxIndex([boxes[0]], 0), -1);
});

console.log(`\n${passed} 项通过`);
