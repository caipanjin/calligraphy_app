/**
 * 切分算法回归测试（纯函数，无需浏览器）
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { findBands, otsuThreshold, estimatePitch, buildGridBoxes } from '../src/utils/segment.js';
import { hashImageData } from '../src/utils/imageHash.js';

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

check('字距估计：周期 20 的投影', () => {
  const profile = new Float32Array(400);
  for (let i = 0; i < 400; i += 1) profile[i] = i % 20 < 10 ? 100 : 5;
  const { pitch } = estimatePitch(profile, 0.05, 0.3);
  assert.ok(Math.abs(pitch - 20) <= 1, `pitch=${pitch}`);
});

check('字距估计：周期 50 的投影', () => {
  const profile = new Float32Array(600);
  for (let i = 0; i < 600; i += 1) profile[i] = i % 50 < 25 ? 80 : 3;
  const { pitch } = estimatePitch(profile, 0.05, 0.4);
  assert.ok(Math.abs(pitch - 50) <= 1, `pitch=${pitch}`);
});

check('网格拟合：3 列 × 2 行，竖排从右往左', () => {
  const W = 300;
  const H = 200;
  const ink = new Uint8Array(W * H);
  const blocks = [];
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const x0 = 10 + c * 100;
      const y0 = 10 + r * 100;
      blocks.push({ x0, y0 });
      for (let y = y0; y < y0 + 80; y += 1) {
        for (let x = x0; x < x0 + 80; x += 1) ink[y * W + x] = 1;
      }
    }
  }
  const boxes = buildGridBoxes(ink, W, H, 100, 'vertical');
  assert.equal(boxes.length, 6);
  // 竖排第一个应是右上角
  assert.ok(boxes[0].x > boxes[1].x, '首格应在右侧');
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1, '前两格同一行');
});

check('网格拟合：空白区域不产出字框', () => {
  const W = 300;
  const H = 200;
  const ink = new Uint8Array(W * H);
  // 只画左上角一个块
  for (let y = 10; y < 90; y += 1) for (let x = 10; x < 90; x += 1) ink[y * W + x] = 1;
  const boxes = buildGridBoxes(ink, W, H, 100, 'vertical');
  assert.equal(boxes.length, 1, `实际 ${boxes.length}`);
});

check('图片哈希：相同内容得到相同键', () => {
  const a = hashImageData('data:image/jpeg;base64,' + 'A'.repeat(5000));
  const b = hashImageData('data:image/jpeg;base64,' + 'A'.repeat(5000));
  assert.equal(a, b);
});

check('图片哈希：不同内容得到不同键', () => {
  const a = hashImageData('data:image/jpeg;base64,' + 'A'.repeat(5000));
  const b = hashImageData('data:image/jpeg;base64,' + 'B'.repeat(5000));
  assert.notEqual(a, b);
});

check('图片哈希：长度不同但前缀相同时可区分', () => {
  const a = hashImageData('x'.repeat(1000));
  const b = hashImageData('x'.repeat(1001));
  assert.notEqual(a, b);
});

check('图片哈希：超长输入仍快速（抽样）', () => {
  const big = 'y'.repeat(8 * 1024 * 1024);
  const t0 = Date.now();
  hashImageData(big);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `耗时 ${ms}ms`);
});

console.log(`\n${passed} 项通过`);
