/**
 * 切分算法回归测试（纯函数，无需浏览器）
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  findBands,
  otsuThreshold,
  detectContentBorder,
  estimatePitch,
  needsWidePitchSearch,
  isSingleWideColumn,
  isNegligibleEdgeBand,
  mergeNarrowGaps,
  isStrokeLevelPitch,
  maxBoxWidthRatio,
  buildGridBoxes,
  splitTallGlyphs,
  blankGuidedCuts,
  mergeSplitGlyphs,
  detectGridLines,
  boxesFromGridLines,
  measureGlyphHorizontally,
  measureGlyphVertically,
  releaseImageElement,
  buildInkMask,
  segmentCharacters
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

// 双联 / 条幅：两列中心距接近半幅图宽（实测 0.483W）。默认上限 0.4W
// 会把真实周期排除，锁到笔画级短周期 65px，导致 splitBandsByPitch 把
// 两条宽列各拆成 3 条窄列。以下用真实图还原的列带验证自适应放宽。
const coupletBands = [{ start: 127, end: 299 }, { start: 521, end: 691 }];
const coupletProfile = new Float32Array(813);
for (const [start, end] of [[127, 299], [521, 691]]) {
  for (let i = start; i < end; i += 1) coupletProfile[i] = 90;
}

check('双联：needsWidePitchSearch 命中真实对联列带', () => {
  assert.equal(needsWidePitchSearch(coupletBands, 813), true);
});

check('双联：放宽上限后能估出真实列周期 393', () => {
  const ratio = needsWidePitchSearch(coupletBands, 813) ? 0.55 : 0.4;
  const { pitch, score } = estimatePitch(coupletProfile, 0.08, ratio);
  assert.ok(Math.abs(pitch - 393) <= 5, `pitch=${pitch}，应接近两列中心距 393`);
  assert.ok(score > 0.4, `score=${score}，真实周期应有明显自相关峰`);
});

check('双联：旧上限 0.4 仍会锁到短周期（说明放宽的必要性）', () => {
  const { pitch } = estimatePitch(coupletProfile, 0.08, 0.4);
  assert.ok(pitch < 100, `pitch=${pitch}，旧上限下应在笔画级短周期`);
});

check('放宽判据：单条全宽列带不放宽（导入面板缩略图网格）', () => {
  // 实测 34-import-sheet：一条覆盖整幅的列带，放宽后在 0.47W 锁到伪周期
  assert.equal(needsWidePitchSearch([{ start: 0, end: 739 }], 739), false);
});

check('放宽判据：两列过宽不放宽（并排卡片界面）', () => {
  // 实测 11-library-dark：两条 330px 宽列带
  assert.equal(
    needsWidePitchSearch([{ start: 40, end: 370 }, { start: 391, end: 721 }], 739),
    false
  );
});

check('放宽判据：两列宽度悬殊不放宽（一侧边框 / 题款）', () => {
  // 实测 28-glyph-width：450 / 116
  assert.equal(
    needsWidePitchSearch([{ start: 20, end: 470 }, { start: 500, end: 616 }], 739),
    false
  );
});

check('放宽判据：列心距在旧上限内不放宽', () => {
  assert.equal(
    needsWidePitchSearch([{ start: 100, end: 270 }, { start: 380, end: 550 }], 813),
    false
  );
});

check('放宽判据：列心距超过 0.55W 也不放宽（放宽也覆盖不到）', () => {
  assert.equal(
    needsWidePitchSearch([{ start: 20, end: 190 }, { start: 650, end: 820 }], 813),
    false
  );
});

check('双联：segmentFromMasks 必须把自适应上限接进真实编排', () => {
  // 纯函数判据测不出「判据写对了却没接到主链路」这种回归，
  // 这里静态守住调用点；真实逐框结果由 couplet-vertical 夹具覆盖。
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(
    /needsWidePitchSearch\(rawColBands,\s*W\)\s*\?\s*0\.55\s*:\s*0\.4/.test(src),
    '主链路应按双联形态选择 0.55 / 0.4 的搜索上限'
  );
  assert.ok(
    /estimatePitch\(colProfile,\s*0\.08,\s*maxPitchRatio\)/.test(src),
    '估计字距时应使用动态上限，而非写死的默认值'
  );
});

check('字距估计：默认上限仍是 0.4W，常规多列周期不受影响', () => {
  const q = new Float32Array(600);
  for (let i = 0; i < 600; i += 1) q[i] = i % 50 < 25 ? 80 : 3;
  const s = new Float32Array(400);
  for (let i = 0; i < 400; i += 1) s[i] = i % 20 < 10 ? 100 : 5;
  assert.ok(Math.abs(estimatePitch(q).pitch - 50) <= 1, '周期 50 应保持不变');
  assert.ok(Math.abs(estimatePitch(s).pitch - 40) <= 1, '周期 20 的二次谐波应保持不变');
});

// 531×1080 黑底「我則」拓片：单列带 [69,489] 宽 420、行带高 491/433、pitch 锁到 42
check('单列大字：命中真实拓片几何量（带宽 420 / 字高 462 / pitch 42）', () => {
  assert.equal(
    isSingleWideColumn(
      [{ start: 69, end: 489 }],
      [{ start: 43, end: 534 }, { start: 608, end: 1041 }],
      531,
      42
    ),
    true
  );
});

check('单列大字：多列、窄列、无字距都不误判', () => {
  const rows = [{ start: 43, end: 534 }, { start: 608, end: 1041 }];
  assert.equal(isSingleWideColumn([{ start: 20, end: 200 }, { start: 300, end: 480 }], rows, 531, 42), false);
  assert.equal(isSingleWideColumn([{ start: 20, end: 200 }], rows, 531, 42), false, '带宽不足半幅');
  assert.equal(isSingleWideColumn([{ start: 69, end: 489 }], [], 531, 42), false, '没有行带');
  assert.equal(isSingleWideColumn([{ start: 69, end: 489 }], rows, 531, 0), false, '没有字距');
});

// 541×1082 黑底大字拓片：主带 [69,495] 宽 426、右侧纸边 [533,541] 仅 8px、pitch 43
check('贴边细带：纸边不算列，单列大字判据仍命中（真实几何量）', () => {
  assert.equal(
    isSingleWideColumn(
      [{ start: 69, end: 495 }, { start: 533, end: 541 }],
      [{ start: 43, end: 501 }, { start: 589, end: 1027 }],
      541,
      43
    ),
    true
  );
});

check('贴边细带：只忽略又细又贴边的带，不误删真实列', () => {
  assert.equal(isNegligibleEdgeBand({ start: 533, end: 541 }, 541), true, '右侧 8px 纸边');
  assert.equal(isNegligibleEdgeBand({ start: 0, end: 8 }, 541), true, '左边缘同样忽略');
  assert.equal(isNegligibleEdgeBand({ start: 250, end: 258 }, 541), false, '图中间的细带不算纸边');
  assert.equal(isNegligibleEdgeBand({ start: 528, end: 536 }, 541), false, '离右边缘还有距离');
  assert.equal(isNegligibleEdgeBand({ start: 511, end: 541 }, 541), false, '30px 已超过 5%W');
  assert.equal(isNegligibleEdgeBand(null, 541), false, '空带不崩');
});

check('贴边细带：剔除后仍有两条实质列带时不命中', () => {
  const rows = [{ start: 43, end: 501 }, { start: 589, end: 1027 }];
  assert.equal(
    isSingleWideColumn(
      [{ start: 20, end: 200 }, { start: 300, end: 480 }, { start: 533, end: 541 }],
      rows,
      541,
      43
    ),
    false
  );
  assert.equal(isSingleWideColumn([{ start: 533, end: 541 }], rows, 541, 43), false, '只剩细带');
});

// 527×1090 黑底「作我」拓片：8px 投影低谷把列带劈成 [59,229] / [237,474]，pitch 锁到 211
check('窄间隙列带：合并后判为单列大字（真实几何量，pitch 211）', () => {
  assert.equal(
    isSingleWideColumn(
      [{ start: 59, end: 229 }, { start: 237, end: 474 }],
      [{ start: 51, end: 483 }, { start: 574, end: 1023 }],
      527,
      211
    ),
    true
  );
});

check('窄间隙列带：只合并 2%W 以内的间隙，不并真实两列', () => {
  const bands = [{ start: 59, end: 229 }, { start: 237, end: 474 }];
  const snapshot = JSON.stringify(bands);
  assert.deepEqual(mergeNarrowGaps(bands, 527), [{ start: 59, end: 474 }], '8px 低谷应合并');
  assert.equal(JSON.stringify(bands), snapshot, '不得改动传入的列带对象');
  assert.equal(mergeNarrowGaps([{ start: 59, end: 229 }, { start: 240, end: 474 }], 527).length, 2, '11px > 2%W 不合并');
  assert.deepEqual(mergeNarrowGaps([{ start: 0, end: 100 }, { start: 105, end: 200 }, { start: 208, end: 300 }], 527),
    [{ start: 0, end: 300 }], '连续窄间隙应逐级合并');
  assert.deepEqual(mergeNarrowGaps([], 527), []);
  assert.deepEqual(mergeNarrowGaps(null, 527), []);
  const rows = [{ start: 51, end: 483 }, { start: 574, end: 1023 }];
  assert.equal(isSingleWideColumn([{ start: 59, end: 229 }, { start: 300, end: 474 }], rows, 527, 211), false,
    '真实两列的宽间隙不会被合并');
});

check('窄间隙列带：未发生合并时「字距接近带宽」的保守条件仍生效', () => {
  const rows = [{ start: 43, end: 534 }, { start: 608, end: 1041 }];
  assert.equal(isSingleWideColumn([{ start: 69, end: 489 }], rows, 531, 200), false,
    'didMerge=false，pitch×2.5 条件必须继续挡住');
});

check('单列大字：带宽远大于字高时仍允许拆列（整张界面截图 2.93）', () => {
  const rows = [252, 252, 252, 252].map((h, i) => ({ start: i * 320, end: i * 320 + h }));
  assert.equal(isSingleWideColumn([{ start: 0, end: 739 }], rows, 739, 59), false);
});

check('单列大字：字距接近带宽时保留拆列（可能是真实两列）', () => {
  const rows = [{ start: 43, end: 534 }, { start: 608, end: 1041 }];
  assert.equal(isSingleWideColumn([{ start: 69, end: 489 }], rows, 531, 200), false);
});

check('单列大字：segmentFromMasks 必须把判据接进字距决策', () => {
  // 纯函数判据测不出「判据写对了却没接到主链路」这种回归
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(
    /isSingleWideColumn\(rawColBands,\s*rowBands,\s*W,\s*pitchEstimate\.pitch\)/.test(src),
    '主链路应把原始列带、行带与字距一起交给判据'
  );
  assert.ok(
    /const pitch = \(singleWideColumn \|\| strokeLevelPitch\) \? 0 : pitchEstimate\.pitch/.test(src),
    '命中任一伪字距判据时字距必须视为 0（同时跳过拆列与网格退化）'
  );
  assert.ok(
    /colBands\.filter\(\(band\) => !isNegligibleEdgeBand\(band, W\)\)/.test(src),
    '判据必须先剔除贴边细带再数实质列带'
  );
  assert.ok(
    /mergeNarrowGaps\(substantial, W\)/.test(src),
    '判据必须先合并窄间隙列带再数实质列带'
  );
  assert.ok(
    /if \(!didMerge && bandWidth < pitch \* 2\.5\)/.test(src),
    '只有发生过合并时才跳过「字距接近带宽」条件'
  );
  assert.ok(
    /const colBands = singleWideColumn\s*\?\s*mergeNarrowGaps\(splitColBands\.filter\(/.test(src),
    '命中单列大字时最终列带必须同时剔除贴边细带并合并窄间隙'
  );
});

// 550×1082 黑底「凡厥」拓片：列带 [47,516] 宽 469，量测后框宽 473，
// 而 0.85W 只有 467.5 —— 两个正确框全被异常块过滤删掉，返回 reason=empty
check('单列大字：宽度上限只在命中时放宽（真实几何 473 vs 467.5）', () => {
  assert.equal(maxBoxWidthRatio(false), 0.85);
  assert.equal(maxBoxWidthRatio(true), 1, 'v10 放宽到整幅宽：单列大字笔画可合法伸到近整幅');
  assert.equal(maxBoxWidthRatio(undefined), 0.85);
  assert.equal(maxBoxWidthRatio(1), 0.85, '只有严格的布尔 true 才放宽');
  assert.ok(473 > 550 * maxBoxWidthRatio(false), '旧上限会删掉 473px 的框');
  assert.ok(473 < 550 * maxBoxWidthRatio(true), '新上限能保留 473px 的框');
  assert.ok(541 <= 541 * maxBoxWidthRatio(true), '整幅宽的合法框（吝驕次字 541px）也要保留');
});

check('单列大字：尺寸过滤必须接进主链路，且高度上限保持 0.85H', () => {
  // helper 测不出「写对了却没接到过滤」或「连高度一起放宽」这两种回归
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(
    /const maxW = \(W \/ scale\) \* maxBoxWidthRatio\(singleWideColumn\)/.test(src),
    '主链路必须用 maxBoxWidthRatio 计算宽度上限'
  );
  assert.ok(
    /const maxH = \(H \/ scale\) \* MAX_SIZE_RATIO/.test(src),
    '高度上限必须保持 0.85H，不能连「整页一个字」一起放过'
  );
  assert.ok(
    /maxWidthRatio: maxBoxWidthRatio\(singleWideColumn\)/.test(src),
    'debug 应记录本次实际使用的宽度上限'
  );
});

// 523×1068 黑底「翁同龢書」拓片：印章列 [79,210] 宽 131、正文列 [327,463] 宽 136，
// pitch 锁到 42（只有列宽的 1/3），isSingleWideColumn 因有两条实质列带不命中
check('笔画级字距：多列版式命中真实几何量（印章列 + 正文列 / pitch 42）', () => {
  const bands = [{ start: 79, end: 210 }, { start: 327, end: 463 }];
  assert.equal(isSingleWideColumn(bands, [{ start: 171, end: 344 }], 523, 42), false,
    '两条独立列带的版式不该由单列大字判据接管');
  assert.equal(isStrokeLevelPitch(bands, 523, 42), true);
});

check('笔画级字距：单列、无字距、字距接近列宽都不命中', () => {
  const bands = [{ start: 79, end: 210 }, { start: 327, end: 463 }];
  assert.equal(isStrokeLevelPitch([{ start: 0, end: 739 }], 739, 59), false, '只有一条列带必须放行');
  assert.equal(isStrokeLevelPitch(bands, 523, 0), false, '没有字距');
  assert.equal(isStrokeLevelPitch(bands, 523, -5), false, '负字距');
  assert.equal(isStrokeLevelPitch(bands, 0, 42), false, '图宽无效');
  assert.equal(isStrokeLevelPitch(null, 523, 42), false, '空列带不崩');
  assert.equal(isStrokeLevelPitch(bands, 523, 79), false, '刚好越过 0.6x131 就不算（严格小于）');
  assert.equal(isStrokeLevelPitch(bands, 523, 100), false, '字距接近列宽时保留拆列');
});

check('笔画级字距：细伪带先剔除，不让 8px 纸边废掉判据', () => {
  assert.equal(
    isStrokeLevelPitch([{ start: 0, end: 8 }, { start: 79, end: 210 }, { start: 327, end: 463 }], 523, 42),
    true,
    '8px < 5%W(26px) 的纸边应被剔除'
  );
  assert.equal(
    isStrokeLevelPitch([{ start: 0, end: 8 }, { start: 79, end: 210 }], 523, 42),
    false,
    '剔除细带后只剩一条实质列带，不命中'
  );
});

check('笔画级字距：全局置 0 会破坏的夹具几何必须保留拆列', () => {
  assert.equal(isStrokeLevelPitch(
    [{ start: 39, end: 131 }, { start: 147, end: 251 }, { start: 257, end: 583 }, { start: 595, end: 699 }],
    707, 120), false, 'dense-grid：最窄带 92，pitch 120 远大于 0.6x92');
  assert.equal(isStrokeLevelPitch([{ start: 0, end: 739 }], 739, 59), false, 'full-screenshot：单条宽列带');
  assert.equal(isStrokeLevelPitch([{ start: 127, end: 299 }, { start: 521, end: 691 }], 813, 388), false,
    'couplet-vertical：真实双联字距');
});

check('笔画级字距：segmentFromMasks 必须把判据接进字距决策', () => {
  // 纯函数判据测不出「判据写对了却没接到主链路」这种回归
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(
    /isStrokeLevelPitch\(rawColBands,\s*W,\s*pitchEstimate\.pitch\)/.test(src),
    '主链路应把原始列带、图宽与估计字距一起交给判据'
  );
  assert.ok(
    /strokeLevelPitch,\s*\n\s*edgeBands:/.test(src),
    'debug 应记录本次是否命中笔画级字距判据'
  );
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

// —— 高字带空白引导切分（v9）——
// 合成掩码：列宽 40（x0=0, x1=40）。普通行 4/40=0.1（不算空白，但足够空），
// 「笔画」行 20/40=0.5，空白行 0/40。这样能分别触发三种切点判定。
const makeSplitGuide = ({ height = 210, inkRows = [], blankRows = [] } = {}) => {
  const width = 40;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const inRow = ([start, end]) => y >= start && y < end;
    const count = blankRows.some(inRow) ? 0 : inkRows.some(inRow) ? 20 : 4;
    for (let x = 0; x < count; x += 1) ink[y * width + x] = 1;
  }
  return { ink, width, x0: 0, x1: width };
};

check('空白引导：切点本来就在空白处时保持原等分', () => {
  const guide = makeSplitGuide({ blankRows: [[100, 112]] });
  const out = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, guide);
  assert.equal(out.length, 2);
  assert.equal(out[0].end, 105, '切点不应被挪动');
  assert.equal(out[1].start, 105);
});

check('空白引导：切点穿过笔画时吸附到附近的空白段', () => {
  // 100-112 有墨（切点 105 穿过笔画），118-126 是真正的字间空白
  const guide = makeSplitGuide({ inkRows: [[100, 112]], blankRows: [[118, 126]] });
  const out = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, guide);
  assert.equal(out.length, 2);
  assert.equal(out[0].end, 122, '应吸附到空白段中点');
  assert.equal(out[1].start, 122);
});

check('空白引导：附近有多个空白段时取最长的一段', () => {
  const guide = makeSplitGuide({
    inkRows: [[100, 112]],
    blankRows: [[118, 122], [125, 135]]
  });
  const out = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, guide);
  assert.equal(out[0].end, 130, '10 行空白应优先于 4 行空白');
});

check('空白引导：切点穿过笔画且附近无空白时撤销这一刀（合成一个字）', () => {
  // 两段空白的中点 49.5 / 164.5 都在吸附半径 31.5 之外
  const guide = makeSplitGuide({
    inkRows: [[100, 112]],
    blankRows: [[10, 90], [130, 200]]
  });
  const out = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, guide);
  assert.equal(out.length, 1, '穿笔画且找不到空白就不能切');
  assert.equal(out[0].start, 0);
  assert.equal(out[0].end, 210);
});

check('空白引导：三等分带只撤销有问题的那一刀', () => {
  // 切点 100 足够空 → 保留；切点 200 穿过笔画且附近无空白 → 撤销
  const guide = makeSplitGuide({
    height: 300,
    inkRows: [[195, 205]],
    blankRows: [[130, 145], [250, 270]]
  });
  const out = splitTallGlyphs([{ start: 0, end: 300 }], 100, 1.7, guide);
  assert.equal(out.length, 2, '三框应变成「独立字 + 一个高字」');
  assert.equal(out[0].end, 100);
  assert.equal(out[1].start, 100);
  assert.equal(out[1].end, 300);
});

check('空白引导：整带墨迹过密时不启用（实心块仍按原逻辑等分）', () => {
  const ink = new Uint8Array(40 * 210).fill(1);
  const out = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, { ink, width: 40, x0: 0, x1: 40 });
  assert.equal(out.length, 2);
  assert.equal(out[0].end, 105);
});

check('空白引导：等分份数超过 3 时不启用（对联长带仍四等分）', () => {
  const guide = makeSplitGuide({ height: 420 });
  const out = splitTallGlyphs([{ start: 0, end: 420 }], 100, 1.7, guide);
  assert.equal(out.length, 4);
  assert.equal(blankGuidedCuts({ start: 0, end: 420 }, 100, [105, 210, 315], 105, 4, guide), null);
});

check('空白引导：带高超过 3.2 倍列宽时不启用', () => {
  const guide = makeSplitGuide({ height: 330 });
  const out = splitTallGlyphs([{ start: 0, end: 330 }], 100, 1.7, guide);
  assert.equal(out.length, 3);
  assert.equal(blankGuidedCuts({ start: 0, end: 330 }, 100, [110, 220], 110, 3, guide), null);
});

check('空白引导：不传 guide 时行为与旧版完全一致', () => {
  const guide = makeSplitGuide({ inkRows: [[100, 112]] });
  const withGuide = splitTallGlyphs([{ start: 0, end: 210 }], 100, 1.7, guide);
  const withoutGuide = splitTallGlyphs([{ start: 0, end: 210 }], 100);
  assert.equal(withGuide.length, 1);
  assert.equal(withoutGuide.length, 2, '没有掩码时仍按列宽机械等分');
  assert.equal(withoutGuide[0].end, 105);
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

// —— v10 字框裁笔画修复：左右独立限额 + 列间空隙 ——
check('按字取宽：左右限额独立，一侧贴边不连坐另一侧', () => {
  const W = 300;
  const H = 100;
  const ink = new Uint8Array(W * H);
  for (let y = 10; y < 40; y += 1) {
    for (let x = 0; x < W; x += 1) ink[y * W + x] = 1; // 整行有墨
  }
  // 列 100-150（宽 50，byRatio=30）；左侧邻列近（gap=5），右侧无邻居
  const m = measureGlyphHorizontally(ink, W, 10, 40, 100, 150, 0.6, 5, Infinity);
  assert.equal(m.extendLeft, 5, '左侧受列间空隙 5px 限制');
  assert.equal(m.extendRight, 30, '右侧无邻居应按列宽比例扩满，不被左侧连坐');
});

check('按字取宽：笔画穿过列边界时跟到真实边缘，不锁死 2px', () => {
  const W = 300;
  const H = 100;
  const ink = new Uint8Array(W * H);
  // 列 100-150，但字的笔画实际占 80-170（左右都穿过列边界）
  for (let y = 10; y < 40; y += 1) {
    for (let x = 80; x < 170; x += 1) ink[y * W + x] = 1;
  }
  // 列间空隙充足（左右各 40），旧算法量「到最近墨迹」会得 0 → 锁死 2px 裁掉笔画
  const m = measureGlyphHorizontally(ink, W, 10, 40, 100, 150, 0.6, 40, 40);
  assert.ok(m.left <= 80, `left=${m.left} 应收进左侧探出笔画`);
  assert.ok(m.right >= 170, `right=${m.right} 应收进右侧探出笔画`);
});

check('按字取宽：伸满列间空隙但不跨进邻列', () => {
  const W = 300;
  const H = 100;
  const ink = new Uint8Array(W * H);
  for (let y = 10; y < 40; y += 1) {
    for (let x = 0; x < W; x += 1) ink[y * W + x] = 1;
  }
  // 左右邻列各只留 8px 空隙：扩展应被空隙封顶，不吞并邻列
  const m = measureGlyphHorizontally(ink, W, 10, 40, 100, 150, 0.6, 8, 8);
  assert.ok(m.extendLeft <= 8, `extendLeft=${m.extendLeft} 应 <= 8`);
  assert.ok(m.extendRight <= 8, `extendRight=${m.extendRight} 应 <= 8`);
});

check('字框裁笔画：主链路用列带边界距离限额，碎片宽度阈值放宽到 0.5', () => {
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  assert.ok(/const gapLeft = prevCol \? col\.start - prevCol\.end : Infinity;/.test(src),
    '水平限额应取到相邻列带边界的距离，而非到最近墨迹的距离');
  assert.ok(/const gapRight = nextCol \? nextCol\.start - col\.end : Infinity;/.test(src),
    '右侧限额应独立取到右邻列带边界的距离');
  assert.ok(/if \(box\.width < medianW \* 0\.5\) return false;/.test(src),
    '碎片过滤宽度阈值应为 0.5，保住行草真实小字');
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

check('释放临时位图：清空 src 并解绑回调', () => {
  const img = { src: 'data:image/jpeg;base64,xxx', onload: () => {}, onerror: () => {} };
  releaseImageElement(img);
  assert.equal(img.src, '');
  assert.equal(img.onload, null);
  assert.equal(img.onerror, null);
});

check('释放临时位图：空值与只读 src 都不抛错', () => {
  releaseImageElement(null);
  releaseImageElement(undefined);
  const stubborn = {};
  Object.defineProperty(stubborn, 'src', {
    set() { throw new Error('read-only'); }
  });
  assert.doesNotThrow(() => releaseImageElement(stubborn));
});

check('segmentCharacters 用完必须释放位图，并把掩码交给 onMask 复用', () => {
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const segmentCharacters'));
  assert.ok(/try\s*\{[\s\S]*segmentFromMasks/.test(body), '切分计算应包在 try 内');
  assert.ok(/finally\s*\{[\s\S]*releaseImageElement\(img\)/.test(body), 'finally 必须释放 img');
  assert.ok(/options\.onMask/.test(body), '应支持把掩码交给调用方复用');
  const onMaskBlock = body.slice(body.indexOf('options.onMask'), body.indexOf('return segmentFromMasks'));
  assert.ok(/ink:\s*mask\.ink/.test(onMaskBlock) && !/faint/.test(onMaskBlock),
    '交给 onMask 的掩码只应含 ink，不能把 faint 一起常驻');
});

// —— 装裱边框检测（v11）：白纸黑字 + 深色装裱边，避免误反色/边框污染 ——
const borderThreshold = (gray) => {
  const hist = new Uint32Array(256);
  for (let p = 0; p < gray.length; p += 1) hist[gray[p]] += 1;
  return otsuThreshold(hist, gray.length);
};

check('装裱边框：深色画框 + 中心浅色纸区命中，返回内容包围盒', () => {
  const W = 100;
  const H = 100;
  const gray = new Uint8Array(W * H).fill(30); // 深色边框
  for (let y = 10; y < 90; y += 1) {
    for (let x = 20; x < 80; x += 1) gray[y * W + x] = 200; // 浅色纸区
  }
  const box = detectContentBorder(gray, W, H, 120); // 明确取暗(30)/亮(200)中间阈值
  assert.ok(box, '应命中装裱边框');
  assert.equal(box.x0, 20);
  assert.equal(box.x1, 80);
  assert.equal(box.y0, 10);
  assert.equal(box.y1, 90);
});

check('装裱边框：整幅都是浅色纸（无边框）不裁', () => {
  const gray = new Uint8Array(100 * 100).fill(200);
  assert.equal(detectContentBorder(gray, 100, 100, borderThreshold(gray)), null);
});

check('装裱边框：黑底稀疏白笔画（拓片）不裁——内容区浅色占比不足', () => {
  const W = 100;
  const H = 100;
  const gray = new Uint8Array(W * H).fill(30); // 黑底
  // 中心区域里只有稀疏白色笔画（浅色占比远低于 50%）
  for (let y = 20; y < 80; y += 6) {
    for (let x = 20; x < 80; x += 1) {
      if (x % 10 < 2) gray[y * W + x] = 220;
    }
  }
  assert.equal(detectContentBorder(gray, W, H, borderThreshold(gray)), null);
});

check('装裱边框：单侧暗条（UI 状态栏，左右不内缩）不裁', () => {
  const W = 100;
  const H = 100;
  const gray = new Uint8Array(W * H).fill(200); // 浅色内容铺满左右
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < W; x += 1) gray[y * W + x] = 30; // 仅顶部暗条
  }
  assert.equal(detectContentBorder(gray, W, H, borderThreshold(gray)), null);
});

check('buildInkMask 结束前释放 canvas 的 backing store', () => {
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const buildInkMask'), src.indexOf('export const projectColumns'));
  assert.ok(/canvas\.width\s*=\s*0/.test(body) && /canvas\.height\s*=\s*0/.test(body),
    '返回前应把 canvas 尺寸置 0');
  assert.ok(body.indexOf('canvas.width = 0') < body.indexOf('return mask'), '释放必须发生在 return 之前');
});

check('切分面板：取尺寸后释放位图，并接入 onMask 复用', () => {
  const src = fs.readFileSync(new URL('../src/components/SegmentSheet.jsx', import.meta.url), 'utf8');
  assert.ok(/finally\s*\{[\s\S]{0,120}releaseImageElement\(img\)/.test(src), '取尺寸的 Image 必须释放');
  assert.ok(/onMask:\s*\(mask\)/.test(src) && /maskRef\.current\s*=\s*mask/.test(src),
    '切分时应把掩码存入 maskRef');
  assert.ok(/return\s*\(\)\s*=>\s*\{[\s\S]{0,160}maskRef\.current\s*=\s*null/.test(src),
    '组件卸载时要清空 maskRef');
});

check('缩略图降级路径用完也释放全尺寸位图', () => {
  const src = fs.readFileSync(new URL('../src/utils/thumbnail.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const makeThumbnailFallback'), src.indexOf('export const makeThumbnails'));
  assert.ok(/finally\s*\{[\s\S]{0,400}?img\.src\s*=\s*''/.test(body), 'onload 分支必须释放');
  assert.ok(/img\.onerror[\s\S]{0,120}img\.src\s*=\s*''/.test(body), 'onerror 分支也要释放');
});

const checkAsync = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name} — ${error.message}`);
    process.exitCode = 1;
  }
};

/** 给解码链路造一个最小 DOM：全白 8x4 图，记录所有 canvas / Image 实例 */
const withMockDom = async (fn) => {
  const prevDoc = globalThis.document;
  const prevImage = globalThis.Image;
  const canvases = [];
  const images = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {},
          getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) })
        })
      };
      canvases.push(canvas);
      return canvas;
    }
  };
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = 8;
      this.naturalHeight = 4;
      this.onload = null;
      this.onerror = null;
      this._src = '';
      images.push(this);
    }
    set src(value) {
      this._src = value;
      if (value) queueMicrotask(() => this.onload && this.onload());
    }
    get src() { return this._src; }
  };
  try {
    return await fn({ canvases, images });
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevImage === undefined) delete globalThis.Image;
    else globalThis.Image = prevImage;
  }
};

await checkAsync('真实解码链路：释放 canvas 与位图后掩码/结果仍完整，onMask 只拿精简掩码', async () => {
  await withMockDom(async ({ canvases, images }) => {
    const direct = buildInkMask({ naturalWidth: 8, naturalHeight: 4 }, 8);
    assert.equal(direct.ink.length, 32, 'ink 应在 canvas 释放后仍可读');
    assert.equal(direct.faint.length, 32);
    assert.equal(canvases[0].width, 0, 'canvas 应已释放');

    let captured = null;
    const result = await segmentCharacters('data:image/png;base64,x', {
      onMask: (mask) => { captured = mask; }
    });
    // 全白合成图没有墨迹，走的是 empty 失败路径（该路径本就不返回 imageWidth，
    // 成功路径的 imageWidth 取值时机由上面的静态断言守住）。
    assert.equal(result.failed, true);
    assert.ok(Array.isArray(result.boxes));
    assert.ok(captured && captured.ink instanceof Uint8Array, 'onMask 应收到掩码');
    assert.equal(captured.faint, undefined, 'onMask 不应携带 faint');
    assert.equal(images[0].src, '', '临时 Image 应被清空');
    assert.equal(images[0].onload, null);
    assert.equal(canvases[1].width, 0, '切分用的 canvas 也应释放');
  });
});

await checkAsync('withFaint=false 跳过格线掩码，ink 与默认完全一致', async () => {
  await withMockDom(async () => {
    const img = { naturalWidth: 8, naturalHeight: 4 };
    const full = buildInkMask(img, 8);
    const lite = buildInkMask(img, 8, { withFaint: false });
    assert.equal(lite.faint, null, '不需要时应返回 null 而非白算一份');
    assert.deepEqual(Array.from(lite.ink), Array.from(full.ink), 'ink 必须逐像素一致');
    assert.equal(lite.width, full.width);
    assert.equal(lite.height, full.height);
    assert.equal(lite.scale, full.scale);
    assert.equal(lite.threshold, full.threshold);
  });
});

check('segmentCharacters 按 hasGrid 决定是否计算 faint', () => {
  const src = fs.readFileSync(new URL('../src/utils/segment.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const segmentCharacters'));
  assert.ok(/withFaint:\s*Boolean\(options\.hasGrid\)/.test(body),
    '免费布局应跳过 faint；有格模式必须仍然计算');
});

check('候选切线构建掩码时显式跳过 faint', () => {
  const src = fs.readFileSync(new URL('../src/utils/inkProfile.js', import.meta.url), 'utf8');
  assert.ok(/buildInkMask\(img,\s*undefined,\s*\{\s*withFaint:\s*false\s*\}\)/.test(src),
    '候选切线只用 ink，不应白算 faint');
});

console.log(`\n${passed} 项通过`);
