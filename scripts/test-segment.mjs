/**
 * 切分算法回归测试（纯函数，无需浏览器）
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { findBands, otsuThreshold } from '../src/utils/segment.js';

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

const buildSums = (bands, length) => {
  const sums = new Uint32Array(length);
  bands.forEach(([start, end, value = 50]) => {
    for (let i = start; i < end; i += 1) sums[i] = value;
  });
  return sums;
};

check('三个独立字符带', () => {
  const sums = buildSums([[5, 25], [35, 55], [65, 85]], 100);
  const bands = findBands(sums, { relInk: 0.15, minGap: 5, minSize: 5 });
  assert.equal(bands.length, 3);
  // 平滑会让边界有 ±2px 偏移
  assert.ok(Math.abs(bands[0].start - 5) <= 2, `start=${bands[0].start}`);
  assert.ok(Math.abs(bands[0].end - 25) <= 2, `end=${bands[0].end}`);
});

check('字内小间隙被合并', () => {
  const sums = buildSums([[5, 25], [28, 48]], 100);
  const bands = findBands(sums, { relInk: 0.15, minGap: 5, minSize: 5 });
  assert.equal(bands.length, 1);
});

check('噪点被过滤', () => {
  const sums = buildSums([[10, 12], [30, 60]], 100);
  const bands = findBands(sums, { relInk: 0.15, minGap: 5, minSize: 5 });
  assert.equal(bands.length, 1);
  assert.ok(Math.abs(bands[0].start - 30) <= 2, `start=${bands[0].start}`);
});

check('尾部字符带正确收尾', () => {
  const sums = buildSums([[20, 50]], 50);
  const bands = findBands(sums, { relInk: 0.15, minGap: 5, minSize: 5 });
  assert.equal(bands.length, 1);
  assert.ok(Math.abs(bands[0].end - 50) <= 2, `end=${bands[0].end}`);
});

check('相对阈值：弱投影（低于峰值 15%）被忽略', () => {
  // 一段强投影（峰值 100） + 一段弱投影（10，低于阈值）
  const sums = new Uint32Array(100);
  for (let i = 0; i < 50; i += 1) sums[i] = 10;
  for (let i = 60; i < 90; i += 1) sums[i] = 100;
  const bands = findBands(sums, { relInk: 0.15, minGap: 5, minSize: 5 });
  assert.equal(bands.length, 1);
  assert.ok(Math.abs(bands[0].start - 60) <= 2, `start=${bands[0].start}`);
});

check('Otsu 阈值落在双峰之间', () => {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < 60; i += 1) histogram[i] = 100;
  for (let i = 180; i < 220; i += 1) histogram[i] = 100;
  const threshold = otsuThreshold(histogram, 10000);
  assert.ok(threshold > 55 && threshold < 185, `threshold=${threshold}`);
});

console.log(`\n${passed} 项通过`);
