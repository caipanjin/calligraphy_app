/** 本列候选切线（findValleys 纯函数）的单元测试 */
import assert from 'node:assert/strict';
import { findValleys } from '../src/utils/inkProfile.js';

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

/** 造一段行投影：blocks 是高墨迹平台，其余为空白 */
const makeProfile = (length, blocks, high = 100, low = 0) => {
  const p = new Float32Array(length).fill(low);
  blocks.forEach(([s, e]) => {
    for (let i = s; i < e; i += 1) p[i] = high;
  });
  return p;
};

check('两个字块之间给出一条空白低谷', () => {
  const v = findValleys(makeProfile(200, [[20, 60], [80, 120]]));
  assert.equal(v.length, 1, `应只找到 1 处低谷，实际 ${v.length}`);
  assert.ok(Math.abs(v[0].y - 70) <= 2, `低谷中心应接近 70，实际 ${v[0].y}`);
  assert.ok(v[0].width >= 15, `低谷宽度 ${v[0].width}`);
});

check('多个低谷按 y 升序返回', () => {
  const v = findValleys(makeProfile(200, [[10, 40], [55, 85], [100, 130], [145, 175]]));
  assert.equal(v.length, 3);
  assert.ok(v[0].y < v[1].y && v[1].y < v[2].y, '必须按位置升序');
  assert.ok(v.every((x) => x.width >= 2 && x.depth >= 0 && x.score > 0), '字段应完整');
});

check('字内笔画间隙也会作为候选返回（只给建议，不替用户判定）', () => {
  // 38-44 是字内部的窄空白，80-100 才是真字间；两者都应出现在候选里
  const v = findValleys(makeProfile(200, [[20, 38], [44, 80], [100, 140]]));
  assert.equal(v.length, 2);
  assert.ok(v[0].y > 30 && v[0].y < 50, `字内低谷 ${v[0].y}`);
});

check('maxCount：候选过多时按显著性保留，再按 y 排序', () => {
  const p = makeProfile(300, [[10, 30], [36, 56], [64, 84], [94, 114], [126, 146], [160, 180]]);
  const all = findValleys(p);
  assert.equal(all.length, 5);
  const few = findValleys(p, { maxCount: 2 });
  assert.equal(few.length, 2);
  assert.ok(few[0].width > all[0].width, '应优先保留更宽（更显著）的低谷');
  assert.ok(few[0].y < few[1].y);
});

check('from / to：只在指定 y 区间内找，且避开区间边界', () => {
  const p = makeProfile(300, [[10, 30], [36, 56], [64, 84], [94, 114], [126, 146], [160, 180]]);
  const v = findValleys(p, { from: 80, to: 140 });
  assert.equal(v.length, 2, `期望 2 处，实际 ${v.map((x) => x.y)}`);
  assert.ok(v.every((x) => x.y > 80 && x.y < 140));
});

check('minSpacing：相邻过近的候选只保留更显著的一条', () => {
  const p = makeProfile(200, [[20, 50], [56, 62], [68, 100]]);
  assert.equal(findValleys(p, { minSpacing: 8 }).length, 2);
  assert.equal(findValleys(p, { minSpacing: 20 }).length, 1);
});

check('relInk：提高相对阈值会纳入更浅的空白', () => {
  const p = new Float32Array(200).fill(100);
  for (let i = 60; i < 80; i += 1) p[i] = 10;
  assert.equal(findValleys(p, { relInk: 0.05 }).length, 0, 'minInk=5 时浅空白不算低谷');
  assert.equal(findValleys(p, { relInk: 0.15 }).length, 1, 'minInk=15 时应算低谷');
});

check('无低谷 / 空输入 / 全零输入都安全', () => {
  assert.deepEqual(findValleys([]), []);
  assert.deepEqual(findValleys(makeProfile(100, [[0, 100]])), []);
  assert.ok(Array.isArray(findValleys(new Float32Array(100))));
  assert.deepEqual(findValleys(null), []);
});

check('不修改输入的投影数组', () => {
  const p = makeProfile(200, [[20, 60], [80, 120]]);
  const before = Array.from(p);
  findValleys(p);
  assert.deepEqual(Array.from(p), before);
});

console.log(`\n${passed} 项通过`);
