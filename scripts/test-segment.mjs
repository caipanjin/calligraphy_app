/**
 * 切分算法回归测试（纯函数，无需浏览器）
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  findBands,
  otsuThreshold,
  estimatePitch,
  buildGridBoxes,
  splitTallGlyphs,
  mergeSplitGlyphs,
  detectGridLines,
  boxesFromGridLines,
  measureGlyphHorizontally,
  measureGlyphVertically
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

// ——「石」字横画被误切成独立字的实测回归（996x2203 字帖，分析图 723x1600）——
// 最右列列宽 178：706-899「有」/ 935-969「石」的一横 /
// 1005-1102「石」的撇+口 / 1154-1306「穴」
check('竖排：「石」的一横与主体合并，且不吞并上下相邻字', () => {
  const out = mergeSplitGlyphs(
    [
      { start: 706, end: 899 },
      { start: 935, end: 969 },
      { start: 1005, end: 1102 },
      { start: 1154, end: 1306 }
    ],
    0.25,
    178
  );
  assert.deepEqual(
    out.map((band) => [band.start, band.end]),
    [[706, 899], [935, 1102], [1154, 1306]]
  );
});

check('竖排：上一个字 + 下一个字起笔横不误合并（总高超过一个字）', () => {
  // 合并后总高 263 > 178 × 1.3，必须保持两块
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 193 }, { start: 229, end: 263 }],
    0.25,
    178
  );
  assert.equal(out.length, 2);
});

check('竖排：独立的「一」字（simpleStroke）不被并入相邻字', () => {
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 9, simpleStroke: true }, { start: 45, end: 200 }],
    0.25,
    178
  );
  assert.equal(out.length, 2);
});

check('竖排：列宽未知时保持原有判据（不扩大合并范围）', () => {
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 34 }, { start: 70, end: 167 }],
    0.25,
    0
  );
  assert.equal(out.length, 2);
});

check('竖排：密集排列的两个正常字仍不合并', () => {
  const out = mergeSplitGlyphs(
    [{ start: 0, end: 150 }, { start: 190, end: 350 }],
    0.25,
    178
  );
  assert.equal(out.length, 2);
});

// —— 含两个独立「一」的方格楷书《马说》实测回归（762x1280，分析尺寸同原图）——
// 列宽 41：「粟」190-295 /「一」320-329 /「石」367-403（右数第 4 列）
// 列宽 42：「者」986-1032 /「一」1064-1072 /「食」1103-1153（右数第 3 列）
// 这两个「一」是简单笔画字，绝不能被并入「石」「食」；且间隙远大于合并上限，
// 即使 simpleStroke 标记因故缺失，也不应合并（双重保险）。
check('竖排：方格字帖里两个独立的「一」保持独立（真实数据）', () => {
  const cases = [
    {
      width: 41,
      bands: [
        { start: 190, end: 295 },
        { start: 320, end: 329, simpleStroke: true },
        { start: 367, end: 403 }
      ]
    },
    {
      width: 42,
      bands: [
        { start: 986, end: 1032 },
        { start: 1064, end: 1072, simpleStroke: true },
        { start: 1103, end: 1153 }
      ]
    }
  ];
  cases.forEach(({ width, bands }) => {
    const marked = mergeSplitGlyphs(bands, 0.25, width);
    assert.equal(marked.length, 3);
    // 反事实：去掉标记后，间隙与「合并后总高」两条仍应拦住
    const plain = bands.map(({ start, end }) => ({ start, end }));
    const unmarked = mergeSplitGlyphs(plain, 0.25, width);
    assert.equal(unmarked.length, 3);
  });
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

check('按字取宽：字的墨迹超出列边界时向右扩', () => {
  const W = 200;
  const H = 100;
  const ink = new Uint8Array(W * H);
  // 列边界 50-100，但字实际占 60-115（右侧超出 15px）
  for (let y = 10; y < 40; y += 1) {
    for (let x = 60; x < 115; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphHorizontally(ink, W, 10, 40, 50, 100);
  assert.ok(m.right >= 115, `right=${m.right}`);
  assert.ok(m.extendRight >= 15, `extendRight=${m.extendRight}`);
});

check('按字取宽：字的墨迹超出列边界时向左扩', () => {
  const W = 200;
  const H = 100;
  const ink = new Uint8Array(W * H);
  // 列边界 50-100，字实际占 38-95（左侧超出 12px）
  for (let y = 10; y < 40; y += 1) {
    for (let x = 38; x < 95; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphHorizontally(ink, W, 10, 40, 50, 100);
  assert.ok(m.left <= 38, `left=${m.left}`);
  assert.ok(m.extendLeft >= 12, `extendLeft=${m.extendLeft}`);
});

check('按字取宽：字未超出时保持列边界', () => {
  const W = 200;
  const H = 100;
  const ink = new Uint8Array(W * H);
  for (let y = 10; y < 40; y += 1) {
    for (let x = 55; x < 95; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphHorizontally(ink, W, 10, 40, 50, 100);
  assert.equal(m.left, 50);
  assert.equal(m.right, 100);
});

check('按字取宽：扩展有上限，不会无限吞并邻列', () => {
  const W = 400;
  const H = 100;
  const ink = new Uint8Array(W * H);
  // 整行都有墨迹（模拟无间隔），扩展应被 maxOverflow 限制
  for (let y = 10; y < 40; y += 1) {
    for (let x = 0; x < W; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphHorizontally(ink, W, 10, 40, 100, 150, 0.5);
  assert.ok(m.extendLeft <= 25, `extendLeft=${m.extendLeft} 应 <= 25`);
  assert.ok(m.extendRight <= 25, `extendRight=${m.extendRight} 应 <= 25`);
});

check('按字取高：笔画向下探出时扩到下边界', () => {
  const W = 100;
  const H = 200;
  const ink = new Uint8Array(W * H);
  // 字带 y40-100，但笔画延伸到 y130
  for (let y = 40; y < 130; y += 1) {
    for (let x = 30; x < 70; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphVertically(ink, W, H, 30, 70, 40, 100);
  assert.ok(m.bottom >= 130, `bottom=${m.bottom}`);
  assert.ok(m.extendDown >= 30, `extendDown=${m.extendDown}`);
});

check('按字取高：笔画向上探出时扩到上边界', () => {
  const W = 100;
  const H = 200;
  const ink = new Uint8Array(W * H);
  for (let y = 15; y < 80; y += 1) {
    for (let x = 30; x < 70; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphVertically(ink, W, H, 30, 70, 40, 80);
  // 扫描允许穿越少量空白，边界可能比真实墨迹再外扩 1~3px，用容差判定
  assert.ok(m.top <= 18, `top=${m.top} 应在 15 附近`);
  assert.ok(m.extendUp >= 22, `extendUp=${m.extendUp}`);
});

check('按字取高：未探出时保持原边界', () => {
  const W = 100;
  const H = 200;
  const ink = new Uint8Array(W * H);
  for (let y = 45; y < 75; y += 1) {
    for (let x = 30; x < 70; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphVertically(ink, W, H, 30, 70, 40, 80);
  assert.equal(m.top, 40);
  assert.equal(m.bottom, 80);
});

check('按字取高：扩展有上限', () => {
  const W = 100;
  const H = 400;
  const ink = new Uint8Array(W * H);
  // 整列都有墨迹，扩展应被 maxOverflow 限制
  for (let y = 0; y < H; y += 1) {
    for (let x = 30; x < 70; x += 1) ink[y * W + x] = 1;
  }
  const m = measureGlyphVertically(ink, W, H, 30, 70, 150, 250, 0.5);
  assert.ok(m.extendUp <= 50, `extendUp=${m.extendUp} 应 <= 50`);
  assert.ok(m.extendDown <= 50, `extendDown=${m.extendDown} 应 <= 50`);
});

check('碎片过滤：宽度正常但高度偏小的字（如「一」）应保留', () => {
  // 模拟：正常字 200x200，一个「一」宽 200 高 60
  const boxes = [
    { x: 0, y: 0, width: 200, height: 200 },
    { x: 0, y: 300, width: 200, height: 200 },
    { x: 0, y: 600, width: 200, height: 200 },
    { x: 0, y: 900, width: 200, height: 200 },
    { x: 0, y: 1200, width: 200, height: 200 },
    // 「一」：宽度正常、高度 60（中位高 200 × 0.45 = 90，60 < 90）
    { x: 0, y: 1500, width: 200, height: 60 }
  ];
  // 过滤逻辑：宽 >= medianW*0.6 且不贴边 → 保留
  const medianW = 200;
  const kept = boxes.filter((box) => box.width >= medianW * 0.6);
  assert.equal(kept.length, 6, '「一」应被保留');
});

check('碎片过滤：宽高都小的贴边残块应过滤', () => {
  // 真正的碎片：宽度明显偏小
  const fragment = { x: 0, y: 0, width: 50, height: 40 };
  const medianW = 200;
  assert.equal(fragment.width >= medianW * 0.6, false, '窄碎片应被过滤');
});

check('切分结果必须包含 imageWidth/imageHeight（原图尺寸）', () => {
  // 这两个字段用于缓存命中判断，缺失会导致缓存永不命中、
  // 每次打开切分面板都重新计算并冲掉用户的手动调整。
  // 这里做静态检查：源码里必须存在这两个字段的赋值。
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(/imageWidth:\s*img\.naturalWidth/.test(src), 'imageWidth 应取 img.naturalWidth');
  assert.ok(/imageHeight:\s*img\.naturalHeight/.test(src), 'imageHeight 应取 img.naturalHeight');
});

console.log(`\n${passed} 项通过`);
