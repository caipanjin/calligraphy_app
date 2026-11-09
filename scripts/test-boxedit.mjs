/** 切分框编辑操作的单元测试 */
import assert from 'node:assert/strict';
import {
  removeBox,
  mergeBoxes,
  splitBox,
  findNearestBoxIndex,
  addBox,
  sortBoxesByReadingOrder,
  groupBoxesByColumn,
  moveBox,
  resizeBox,
  setColumnBoundary,
  columnBoundaries,
  resegmentColumnRange,
  snapValue,
  pickRegionCuts,
  MIN_BOX_SIZE
} from '../src/utils/boxEdit.js';

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
  assert.equal(out[0].height, 200);
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

check('加框：同列内按 y 顺序插入', () => {
  const input = [
    { x: 100, y: 100, width: 200, height: 200 },
    { x: 100, y: 400, width: 200, height: 200 }
  ];
  const out = addBox(input, { x: 100, y: 250, width: 200, height: 120 }, true);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((b) => b.y), [100, 250, 400]);
});

check('加框：不同列时按 x 从右到左', () => {
  const input = [
    { x: 100, y: 100, width: 200, height: 200 },
    { x: 400, y: 100, width: 200, height: 200 }
  ];
  const out = addBox(input, { x: 100, y: 350, width: 200, height: 120 }, true);
  assert.equal(out[0].x, 400);
});

check('加框：不修改原数组', () => {
  const input = [{ x: 100, y: 100, width: 200, height: 200 }];
  const before = JSON.stringify(input);
  addBox(input, { x: 100, y: 400, width: 200, height: 200 }, true);
  assert.equal(JSON.stringify(input), before);
});

/* ---- 阅读顺序与列聚类 ---- */

check('阅读顺序：抽出后的排序与加框一致', () => {
  const input = [
    { x: 100, y: 400, width: 200, height: 200 },
    { x: 400, y: 100, width: 200, height: 200 }
  ];
  const sorted = sortBoxesByReadingOrder(input, true);
  assert.equal(sorted[0].x, 400);
  assert.equal(sorted[1].x, 100);
  assert.deepEqual(sorted, addBox([input[0]], input[1], true));
});

check('列聚类：4 列字数不同、字位错落也能正确分组', () => {
  const input = [
    { x: 500, y: 40, width: 100, height: 100 },
    { x: 500, y: 190, width: 100, height: 150 },
    { x: 500, y: 368, width: 100, height: 120 },
    { x: 300, y: 28, width: 100, height: 195 },
    { x: 300, y: 234, width: 100, height: 162 },
    { x: 100, y: 43, width: 100, height: 191 }
  ];
  const cols = groupBoxesByColumn(input);
  assert.equal(cols.length, 3);
  assert.deepEqual(cols.map((c) => c.indices.length), [3, 2, 1]);
  assert.deepEqual(cols[0].indices, [0, 1, 2]);
});

check('列聚类：空数组与单框', () => {
  assert.deepEqual(groupBoxesByColumn([]), []);
  assert.deepEqual(groupBoxesByColumn([boxes[0]]).map((c) => c.indices), [[0]]);
});

/* ---- 平移 ---- */

check('平移：正常移动且索引顺序不变', () => {
  const out = moveBox(boxes, 1, 10, -20, { width: 1000, height: 1000 });
  assert.deepEqual({ x: out[1].x, y: out[1].y }, { x: 10, y: 100 });
  assert.deepEqual(out.map((b) => b.width), [100, 100, 100]);
  assert.notEqual(out, boxes);
});

check('平移：左上角与右下角都被钳制在图片内', () => {
  const top = moveBox(boxes, 0, -500, -500, { width: 300, height: 300 });
  assert.deepEqual({ x: top[0].x, y: top[0].y }, { x: 0, y: 0 });
  const bottom = moveBox(boxes, 0, 5000, 5000, { width: 300, height: 300 });
  assert.deepEqual({ x: bottom[0].x, y: bottom[0].y }, { x: 200, y: 200 });
});

check('平移：无变化时返回原数组，非法索引安全', () => {
  assert.equal(moveBox(boxes, 0, 0, 0, { width: 1000, height: 1000 }), boxes);
  assert.equal(moveBox(boxes, 99, 10, 10), boxes);
  assert.equal(moveBox(boxes, 0, NaN, 0), boxes);
});

check('平移：不修改原数组', () => {
  const before = JSON.stringify(boxes);
  moveBox(boxes, 0, 50, 50, { width: 1000, height: 1000 });
  assert.equal(JSON.stringify(boxes), before);
});

/* ---- 拉伸 ---- */

check('拉伸：下边只改高度，上边保持不动', () => {
  const out = resizeBox(boxes, 0, 's', 0, 40, { width: 1000, height: 1000 });
  assert.equal(out[0].y, 0);
  assert.equal(out[0].height, 140);
});

check('拉伸：上边下移时下边保持不动', () => {
  const out = resizeBox(boxes, 0, 'n', 0, 30, { width: 1000, height: 1000 });
  assert.equal(out[0].y, 30);
  assert.equal(out[0].height, 70);
  assert.equal(out[0].y + out[0].height, 100);
});

check('拉伸：四角同时改变位置与尺寸（左边界被图片钳制）', () => {
  const out = resizeBox(boxes, 1, 'nw', -20, -10, { width: 1000, height: 1000 });
  assert.equal(out[1].x, 0, 'x 已在左边界，继续往左拖应被钳制');
  assert.equal(out[1].y, 110);
  assert.equal(out[1].width, 100);
  assert.equal(out[1].height, 90);
});

check('拉伸：最小尺寸保护，不会压成零或负数', () => {
  const out = resizeBox(boxes, 0, 's', 0, -1000, { width: 1000, height: 1000 });
  assert.equal(out[0].height, MIN_BOX_SIZE);
  const left = resizeBox(boxes, 0, 'w', 1000, 0, { width: 1000, height: 1000 });
  assert.equal(left[0].width, MIN_BOX_SIZE);
});

check('拉伸：右/下边被图片边界钳制', () => {
  const out = resizeBox(boxes, 0, 'se', 1000, 1000, { width: 250, height: 250 });
  assert.equal(out[0].x + out[0].width, 250);
  assert.equal(out[0].y + out[0].height, 250);
});

check('拉伸：非法边名与非法索引安全', () => {
  assert.equal(resizeBox(boxes, 99, 's', 0, 10), boxes);
  assert.equal(resizeBox(boxes, 0, 'x', 0, 10), boxes);
});

/* ---- 本列切线 ---- */

check('本列切线：取相邻框边界中点', () => {
  assert.deepEqual(columnBoundaries(boxes, [0, 1, 2]), [110, 210]);
  assert.deepEqual(columnBoundaries(boxes, [0]), []);
});

check('拖动切线：上下两框同步、不重叠不留缝', () => {
  const out = setColumnBoundary(boxes, [0, 1, 2], 0, 110);
  assert.equal(out[0].y + out[0].height, 110);
  assert.equal(out[1].y, 110);
  assert.equal(out[1].y + out[1].height, 200);
  assert.equal(out[2].y, 220);
});

check('拖动切线：钳制在两框内部，不会把字压没', () => {
  const low = setColumnBoundary(boxes, [0, 1], 0, -9999);
  assert.equal(low[0].height, MIN_BOX_SIZE);
  const high = setColumnBoundary(boxes, [0, 1], 0, 9999);
  assert.equal(high[1].height, MIN_BOX_SIZE);
});

check('拖动切线：越界 boundaryIndex 与非法 y 安全', () => {
  assert.equal(setColumnBoundary(boxes, [0, 1], 1, 110), boxes);
  assert.equal(setColumnBoundary(boxes, [0, 1], -1, 110), boxes);
  assert.equal(setColumnBoundary(boxes, [0, 1], 0, NaN), boxes);
});

check('重切本段：3 条切线把 5 个框切成 4 个', () => {
  const input = [
    { x: 100, y: 100, width: 100, height: 100 },
    { x: 100, y: 200, width: 100, height: 100 },
    { x: 100, y: 300, width: 100, height: 100 },
    { x: 100, y: 400, width: 100, height: 100 },
    { x: 100, y: 500, width: 100, height: 100 },
    { x: 400, y: 100, width: 100, height: 100 }
  ];
  const out = resegmentColumnRange(input, [0, 1, 2, 3, 4], [150, 300, 450]);
  assert.equal(out.length, 5);
  const left = out.filter((b) => b.x === 100);
  assert.equal(left.length, 4);
  assert.deepEqual(left.map((b) => b.height), [50, 150, 150, 150]);
  assert.equal(left[0].y, 100);
  assert.equal(left[3].y + left[3].height, 600);
  assert.equal(out[0].x, 400, '右列仍应排在最前');
});

check('重切本段：x 与宽度取中位数，不被异常框带偏', () => {
  const input = [
    { x: 100, y: 100, width: 100, height: 100 },
    { x: 100, y: 200, width: 100, height: 100 },
    { x: 100, y: 300, width: 400, height: 100 }
  ];
  const out = resegmentColumnRange(input, [0, 1, 2], [250]);
  assert.equal(out.length, 2);
  assert.ok(out.every((b) => b.width === 100), `宽度应取中位数，实际 ${out.map((b) => b.width)}`);
});

check('重切本段：过近/越界的切线被忽略，无有效切线时原样返回', () => {
  const input = [boxes[0], boxes[1], boxes[2]];
  assert.equal(resegmentColumnRange(input, [0, 1], [], true), input);
  assert.equal(resegmentColumnRange(input, [0, 1], [9999], true), input);
  const out = resegmentColumnRange(input, [0, 1, 2], [150, 152], true);
  assert.equal(out.filter((b) => b.y === 150).length, 1, '相距 <8px 的切线应去重');
});

check('重切本段：不修改原数组，重复调用幂等', () => {
  const input = [
    { x: 100, y: 100, width: 100, height: 100 },
    { x: 100, y: 200, width: 100, height: 100 }
  ];
  const before = JSON.stringify(input);
  const once = resegmentColumnRange(input, [0, 1], [150]);
  const twice = resegmentColumnRange(once, [0, 1], [150]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(once, twice);
});

/* ---- 吸附 ---- */

check('吸附：容差内命中最近候选', () => {
  assert.equal(snapValue(103, [100, 200], 8), 100);
  assert.equal(snapValue(197, [100, 200], 8), 200);
  assert.equal(snapValue(104, [100, 106], 8), 106, '多个候选都在容差内时取最近的');
  assert.equal(snapValue(103, [100, 106], 8), 100, '距离相同时取先出现的候选');
});

check('吸附：容差外、空候选、非法值都原样返回', () => {
  assert.equal(snapValue(150, [100, 200], 8), 150);
  assert.equal(snapValue(150, [], 8), 150);
  assert.equal(snapValue(NaN, [100], 8), NaN);
});

/* ---------------- 区域二次切分（编辑态拖区域 → 一次切多框） ---------------- */

check('区域切分护栏：过滤字内笔画缝产生的过近候选线', () => {
  // IMG_4596 右题款实测：574→621 只隔 47px，小于 0.55×110=61px，
  // 属于字内笔画间隙，默认不勾选；用户仍可在界面上手动补选。
  const region = { x: 930, y: 450, width: 110, height: 670 };
  assert.deepEqual(
    pickRegionCuts([574, 621, 665, 767, 872, 1007], region),
    [574, 665, 767, 872, 1007]
  );
});

check('区域切分护栏：区域外与贴边的切线剔除，结果去重升序', () => {
  const region = { x: 0, y: 100, width: 100, height: 500 };
  // 有效区间 (155, 545)；154 / 590 / 601 越界，300 与 260 相距不足 55px
  assert.deepEqual(pickRegionCuts([80, 154, 590, 601, 300, 300, 260, 400], region), [260, 400]);
});

check('区域切分护栏：空候选 / 非法区域返回空，ratio 可调', () => {
  const region = { x: 0, y: 0, width: 100, height: 500 };
  assert.deepEqual(pickRegionCuts([], region), []);
  assert.deepEqual(pickRegionCuts(null, region), []);
  assert.deepEqual(pickRegionCuts([200], null), []);
  assert.deepEqual(pickRegionCuts([200], { x: 0, y: 0, width: 0, height: 100 }), []);
  assert.deepEqual(pickRegionCuts([200], { x: 0, y: 0, width: -1, height: 100 }), []);
  // 放宽到 0.2（minGap=22px）后，相距 47px 的两条线都保留
  assert.deepEqual(pickRegionCuts([574, 621], { x: 930, y: 450, width: 110, height: 670 }, 0.2), [574, 621]);
  assert.ok(Math.round(MIN_BOX_SIZE) > 0, '护栏下限至少不小于最小框尺寸');
});

check('区域切分：大框 + 切线一次切成多框，原框不变且按阅读顺序插入', () => {
  const existing = [
    { x: 700, y: 100, width: 200, height: 200 },
    { x: 700, y: 350, width: 200, height: 200 },
    { x: 200, y: 100, width: 200, height: 200 },
    { x: 200, y: 350, width: 200, height: 200 }
  ];
  const region = { x: 930, y: 100, width: 90, height: 450 };
  // 组件里的用法：把区域大框临时追加到末尾，只重切它一个
  const draft = [...existing, region];
  const next = resegmentColumnRange(draft, [existing.length], [200, 300, 400], true);
  assert.equal(next.length, existing.length + 4, '3 条切线应切出 4 个框');
  const added = next.filter((b) => b.x === region.x && b.width === region.width);
  assert.equal(added.length, 4);
  assert.deepEqual(added.map((b) => b.y), [100, 200, 300, 400]);
  assert.deepEqual(added.map((b) => b.height), [100, 100, 100, 150]);
  existing.forEach((b) => assert.ok(
    next.some((n) => n.x === b.x && n.y === b.y && n.width === b.width && n.height === b.height),
    '原有框应原样保留'
  ));
  const firstOriginal = next.findIndex((b) => b.x === 700);
  assert.ok(next.indexOf(added[0]) < firstOriginal, '题款列在最右，应排在正文前面而不是堆在数组末尾');
});

console.log(`\n${passed} 项通过`);
