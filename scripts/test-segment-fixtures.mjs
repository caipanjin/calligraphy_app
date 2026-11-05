/**
 * 真实图 golden 回归测试：用位压缩的墨迹/格线掩码调用真实切分链路，
 * 逐框比对固定快照。这样以后改动 findBands / mergeSplitGlyphs / 碎片过滤 /
 * 格线检测，或调整切分编排顺序，都能立刻看到「哪张图、第几框」变了。
 *
 * 运行：
 *   node scripts/test-segment-fixtures.mjs             # 比对快照
 *   node scripts/test-segment-fixtures.mjs --update    # 有意更新快照
 *
 * 夹具由 scripts/gen-segment-fixtures.py 生成（原始图片不进仓库）。
 * 位压缩规则：每像素 1 bit，行优先、MSB first。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentFromMasks } from '../src/utils/segment.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'fixtures', 'segment');
const UPDATE = process.argv.includes('--update');

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

const unpack = (buf, length) => {
  const expected = Math.ceil(length / 8);
  assert.equal(buf.length, expected, `掩码长度不符：期望 ${expected} 字节，实际 ${buf.length}`);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = (buf[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return out;
};

const normalize = (result) => ({
  strategy: result.strategy || 'projection',
  layout: result.layout,
  failed: Boolean(result.failed),
  columns: result.columns,
  boxes: (result.boxes || []).map((box) => ({
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.width),
    h: Math.round(box.height),
    ...(box.simpleStroke ? { simpleStroke: true } : {})
  }))
});

/** 返回可读的差异列表；空数组表示完全一致 */
const findDiff = (expected, actual) => {
  const out = [];
  ['strategy', 'layout', 'failed', 'columns'].forEach((key) => {
    if (expected[key] !== actual[key]) {
      out.push(`${key}: 期望 ${expected[key]} / 实际 ${actual[key]}`);
    }
  });
  if (expected.boxes.length !== actual.boxes.length) {
    out.push(`框数: 期望 ${expected.boxes.length} / 实际 ${actual.boxes.length}`);
  }
  const count = Math.min(expected.boxes.length, actual.boxes.length);
  for (let i = 0; i < count; i += 1) {
    const a = JSON.stringify(expected.boxes[i]);
    const b = JSON.stringify(actual.boxes[i]);
    if (a !== b) out.push(`第 ${i + 1} 框: 期望 ${a} / 实际 ${b}`);
  }
  return out;
};

// 比对器自检：确保「算法改了但测试没报错」这种假阳性不会发生
check('比对器自检：能发现单个框的坐标变化', () => {
  const base = normalize({ strategy: 'projection', layout: 'vertical', columns: 1, boxes: [{ x: 1, y: 2, width: 30, height: 40 }] });
  const changed = { ...base, boxes: [{ x: 1, y: 2, w: 30, h: 41 }] };
  assert.ok(findDiff(base, changed).some((line) => line.includes('第 1 框')));
});
check('比对器自检：能发现框数变化与策略变化', () => {
  const base = normalize({ strategy: 'projection', layout: 'vertical', columns: 1, boxes: [{ x: 1, y: 2, width: 30, height: 40 }] });
  const changed = { ...base, strategy: 'grid', boxes: [] };
  const diff = findDiff(base, changed);
  assert.ok(diff.some((line) => line.includes('框数')));
  assert.ok(diff.some((line) => line.includes('strategy')));
});

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'sources.json').sort();
assert.ok(files.length > 0, '没有找到任何夹具');

files.forEach((file) => {
  const file_path = path.join(DIR, file);
  const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  const pixelCount = doc.width * doc.height;
  const ink = unpack(fs.readFileSync(path.join(DIR, doc.inkFile)), pixelCount);
  const faint = unpack(fs.readFileSync(path.join(DIR, doc.faintFile)), pixelCount);

  doc.cases.forEach((fixtureCase) => {
    const actual = normalize(
      segmentFromMasks(ink, faint, {
        width: doc.width,
        height: doc.height,
        scale: doc.scale,
        imageWidth: doc.imageWidth,
        imageHeight: doc.imageHeight,
        ...fixtureCase.options
      })
    );
    const label = `${doc.name} / ${fixtureCase.id}`;

    if (UPDATE) {
      fixtureCase.expected = actual;
      console.log(`SNAP  ${label} — 写入 ${actual.boxes.length} 框`);
      return;
    }

    check(`真实图夹具：${label}（${fixtureCase.expected?.boxes.length ?? '?'} 框）`, () => {
      assert.ok(fixtureCase.expected, `${label} 尚未生成快照，请先运行 --update`);
      const diff = findDiff(fixtureCase.expected, actual);
      assert.equal(diff.length, 0, `${label} 共 ${diff.length} 处差异：\n    ${diff.slice(0, 8).join('\n    ')}${diff.length > 8 ? '\n    ...' : ''}`);
    });
  });

  if (UPDATE) {
    fs.writeFileSync(file_path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }
});

console.log(`\n${UPDATE ? '快照已更新' : `${passed} 项通过`}`);
