/**
 * 切分算法回归测试（纯函数，无需浏览器）
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import {
  findBands,
  otsuThreshold,
  estimatePitch,
  buildGridBoxes,
  splitTallGlyphs,
  mergeSplitGlyphs,
  detectGridLines,
  boxesFromGridLines
} from '../src/utils/segment.js';
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
  // 竖排：先走完右列（同列 y 递增），再换到左列
  assert.ok(boxes[0].x > boxes[1].x || Math.abs(boxes[0].x - boxes[1].x) < 1, '首格在最右列');
  assert.ok(Math.abs(boxes[0].x - boxes[1].x) < 1, '前两格在同一列');
  assert.ok(boxes[1].y > boxes[0].y, '同列内 y 递增');
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

check('竖排：高宽比 1.44 的字不拆分（正常长竖笔）', () => {
  // 实测正常字上限 1.44，阈值 1.7，不应拆分
  const out = splitTallGlyphs([{ start: 625, end: 859 }], 162);
  assert.equal(out.length, 1, `实际拆成 ${out.length} 块`);
});

check('竖排：高宽比 2.1 的粘连块拆分', () => {
  // 列宽 162，块高 340（比值 2.1）应拆成 2 块
  const out = splitTallGlyphs([{ start: 0, end: 340 }], 162);
  assert.equal(out.length, 2);
});

check('竖排：正常高度的块不拆分', () => {
  const out = splitTallGlyphs([{ start: 48, end: 228 }, { start: 255, end: 385 }], 162);
  assert.equal(out.length, 2);
});

check('竖排：部件合并——小碎片紧邻大块时合并', () => {
  // 小块 40 宽紧贴大块 150 宽，间隙 10（<平均宽 25%）
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 40 }, { start: 50, end: 200 }],
    0.25,
    160
  );
  assert.equal(out.length, 1);
});

check('竖排：两个正常字之间不合并', () => {
  // 两块各 150 宽，间隙 100（>平均宽 25%）
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 150 }, { start: 250, end: 400 }],
    0.25,
    160
  );
  assert.equal(out.length, 2);
});

check('格线检测：识别出全格（列+行）', () => {
  const W = 400;
  const H = 500;
  const faint = new Uint8Array(W * H);
  const ink = new Uint8Array(W * H);
  const vLines = [100, 200, 300];
  const hLines = [120, 240, 360];
  vLines.forEach((x) => {
    for (let y = 0; y < H; y += 1) faint[y * W + x] = 1;
  });
  hLines.forEach((y) => {
    for (let x = 0; x < W; x += 1) faint[y * W + x] = 1;
  });
  const grid = detectGridLines(faint, ink, W, H);
  assert.equal(grid.kind, 'full');
  assert.equal(grid.vertical.length, 3);
  assert.equal(grid.horizontal.length, 3);
});

check('格线检测：无线条时返回 none', () => {
  const faint = new Uint8Array(200 * 200);
  const ink = new Uint8Array(200 * 200);
  const grid = detectGridLines(faint, ink, 200, 200);
  assert.equal(grid.kind, 'none');
});

check('由格线生成单元格：竖排从右往左', () => {
  const grid = { vertical: [100, 200, 300], horizontal: [100, 200, 300] };
  const boxes = boxesFromGridLines(grid, 'vertical');
  assert.equal(boxes.length, 4);
  // 竖排：先右列自上而下，再左列
  assert.equal(boxes[0].x, 200, '首格在最右列');
  assert.equal(boxes[1].x, 200, '第二格仍在右列');
  assert.ok(boxes[1].y > boxes[0].y, '同列内 y 递增');
  assert.equal(boxes[2].x, 100, '第三格换到左列');
});

check('由格线生成单元格：横排从左往右', () => {
  const grid = { vertical: [100, 200, 300], horizontal: [100, 200, 300] };
  const boxes = boxesFromGridLines(grid, 'horizontal');
  assert.equal(boxes.length, 4);
  // 横排：先上行从左到右
  assert.equal(boxes[0].x, 100);
  assert.equal(boxes[1].x, 200);
  assert.equal(boxes[0].y, boxes[1].y, '前两格同一行');
});

console.log(`\n${passed} 项通过`);
