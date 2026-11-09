/**
 * 离线验证「长带按本列真实空白切分」候选修复 —— 不修改 src/ 任何文件。
 *
 * 做法：把 src/utils/segment.js 读成文本，在内存里注入一个候选版
 * splitTallGlyphsV12，写到 /tmp 后动态 import；原版与候选版对同一批掩码
 * 跑 segmentFromMasks，逐框比对。这样能同时回答两件事：
 *   1) 目标图（红底对联）能否把左联下半切回贴合字位的框；
 *   2) 其余 13 套 golden 夹具是否零变化（改动风险有多大）。
 *
 * 候选思路：parts ≥ 4 的长带不再按列宽机械等分，而是用本列行投影里
 * 连续空白段（密度护栏 / 空白阈值 / 边距护栏沿用 blankGuidedCuts 的常量）
 * 直接作为切点；找不到 ≥2 个可信空白段时完全回退原逻辑。
 *
 * 运行：node scripts/verify-couplet-candidate.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src', 'utils', 'segment.js');
const DIR = path.join(HERE, 'fixtures', 'segment');
const DEBUG_DIR = path.join(os.tmpdir(), 'calligraphy-debug');

const CANDIDATE_CODE = `
// —— 候选修复：只在「≥4 等分的长带」上启用，其余完全回退原逻辑 ——
const longBandBlankCutsV12 = (band, referenceSize, guide) => {
  const { ink, width, x0, x1 } = guide;
  const size = band.end - band.start;
  const colW = Math.max(1, x1 - x0);
  const profile = new Uint32Array(size);
  let total = 0;
  for (let i = 0; i < size; i += 1) {
    const row = (band.start + i) * width;
    let value = 0;
    for (let x = x0; x < x1; x += 1) value += ink[row + x];
    profile[i] = value;
    total += value;
  }
  if (globalThis.__CAND_DEBUG) {
    console.log('  [long] band=[' + band.start + ',' + band.end + '] density=' +
      (total / (size * colW)).toFixed(3) + ' (limit ' + SPLIT_GUIDE_MAX_DENSITY + ')');
  }
  if (total / (size * colW) > SPLIT_GUIDE_MAX_DENSITY) return null;
  const blankLimit = colW * SPLIT_GUIDE_BLANK_RATIO;
  const edge = referenceSize * SPLIT_GUIDE_EDGE_RATIO;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= size; i += 1) {
    const blank = i < size && profile[i] <= blankLimit;
    if (blank && start < 0) start = i;
    if (!blank && start >= 0) {
      if (i - start >= SPLIT_GUIDE_MIN_BLANK_RUN) {
        const mid = band.start + (start + i - 1) / 2;
        if (mid - band.start >= edge && band.end - mid >= edge) {
          runs.push({ mid: Math.round(mid), len: i - start });
        }
      }
      start = -1;
    }
  }
  if (globalThis.__CAND_DEBUG) {
    console.log('  [long] density=' + (total / (size * colW)).toFixed(3),
      'runs=' + runs.length, runs.map((r) => r.mid + '(' + r.len + ')').join(','));
  }
  if (runs.length < 2) return null;
  return [...new Set(runs.map((run) => run.mid))]
    .filter((cut) => cut > band.start + 2 && cut < band.end - 2)
    .sort((a, b) => a - b);
};

// 方案 B：不用空白吸附，改为在长带内部用更小的 minGap 重新跑 findBands，
// 让「字间空白只有 3~10px」也能被识别成独立字带（只对 ≥4 倍列宽的超长带启用）。
const longBandRebandV12 = (band, referenceSize, guide, parts) => {
  const { ink, width, x0, x1 } = guide;
  const size = band.end - band.start;
  if (size < referenceSize * 4) return null;
  const profile = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    const row = (band.start + i) * width;
    let value = 0;
    for (let x = x0; x < x1; x += 1) value += ink[row + x];
    profile[i] = value;
  }
  const minGap = Math.max(2, Math.round(referenceSize * 0.02));
  const minSize = Math.max(2, Math.round(referenceSize * 0.35));
  const sub = findBands(profile, { relInk: INK_RATIO, minGap, minSize });
  if (globalThis.__CAND_DEBUG) {
    console.log('  [reband] sub=' + sub.length + ' ' +
      sub.map((b) => '[' + (b.start + band.start) + ',' + (b.end + band.start) + ']h' + (b.end - b.start)).join(' '));
  }
  // 收紧触发：重切出的带数必须接近原等分数（挡住 UI 截图里 20 等分塌成 3 带），
  // 且每条带高都要接近一个正常字（0.8~1.6 倍列宽）。
  if (sub.length < Math.max(3, parts - 1) || sub.length > parts + 1) return null;
  const heights = sub.map((b) => b.end - b.start);
  if (heights.some((h) => h < referenceSize * 0.8 || h > referenceSize * 1.6)) return null;
  return sub.map((b) => ({ start: b.start + band.start, end: b.end + band.start }));
};

const splitTallGlyphsV12 = (bands, referenceSize, maxRatio = 1.7, guide = null) => {
  if (bands.length === 0 || referenceSize <= 0) return bands;
  const result = [];
  bands.forEach((band) => {
    const size = band.end - band.start;
    if (globalThis.__CAND_DEBUG) {
      console.log('  [band] [' + band.start + ',' + band.end + '] size=' + size,
        'ref=' + referenceSize, 'limit=' + (referenceSize * maxRatio).toFixed(0));
    }
    if (size <= referenceSize * maxRatio) { result.push(band); return; }
    const parts = Math.max(2, Math.round(size / referenceSize));
    const step = size / parts;
    const ideal = [];
    for (let i = 1; i < parts; i += 1) ideal.push(Math.round(band.start + i * step));
    const rebanded = (parts >= 4 && guide) ? longBandRebandV12(band, referenceSize, guide, parts) : null;
    if (globalThis.__CAND_DEBUG && parts >= 4) {
      console.log('  [split] parts=' + parts + ' reband=' + (rebanded ? rebanded.length + ' 带' : 'null'));
    }
    if (rebanded) { result.push(...rebanded); return; }
    const cuts = guide ? blankGuidedCuts(band, referenceSize, ideal, step, parts, guide) : null;
    if (!cuts) {
      for (let i = 0; i < parts; i += 1) {
        result.push({
          start: Math.round(band.start + i * step),
          end: Math.round(band.start + (i + 1) * step)
        });
      }
      return;
    }
    const points = [band.start, ...cuts, band.end];
    for (let i = 0; i < points.length - 1; i += 1) {
      result.push({ start: points[i], end: points[i + 1] });
    }
  });
  return result;
};
`;

const source = fs.readFileSync(SRC, 'utf8');
const anchor = 'export const segmentFromMasks = (';
const callSite = '      const charBands = splitTallGlyphs(';
if (!source.includes(anchor) || !source.includes(callSite)) {
  throw new Error('源码结构已变化，离线补丁无法安全注入');
}
const patched = source
  .replace(anchor, `${CANDIDATE_CODE}\n${anchor}`)
  .replace(callSite, '      const charBands = splitTallGlyphsV12(');
const candidatePath = path.join(os.tmpdir(), 'segment-candidate.mjs');
fs.writeFileSync(candidatePath, patched);

const base = await import(pathToFileURL(SRC).href);
const cand = await import(`${pathToFileURL(candidatePath).href}?v=${Date.now()}`);

const unpack = (buf, length) => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (buf[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
};
const normalize = (r) => ({
  strategy: r.strategy || 'projection',
  layout: r.layout,
  failed: Boolean(r.failed),
  columns: r.columns,
  boxes: (r.boxes || []).map((b) => ({
    x: Math.round(b.x), y: Math.round(b.y),
    w: Math.round(b.width), h: Math.round(b.height)
  }))
});
const roundBoxes = (boxes) => boxes.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }));

// ——— 1. 全部 golden 夹具：原版 vs 候选版 ———
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
let totalCases = 0;
const changed = [];
console.log(`\n=== golden 夹具回归对比（${files.length} 套）===`);
for (const file of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const pixels = doc.width * doc.height;
  const ink = unpack(fs.readFileSync(path.join(DIR, doc.inkFile)), pixels);
  const faint = unpack(fs.readFileSync(path.join(DIR, doc.faintFile)), pixels);
  for (const fixtureCase of doc.cases) {
    totalCases += 1;
    const opts = {
      width: doc.width, height: doc.height, scale: doc.scale,
      imageWidth: doc.imageWidth, imageHeight: doc.imageHeight,
      ...fixtureCase.options
    };
    const a = normalize(base.segmentFromMasks(ink, faint, opts));
    const b = normalize(cand.segmentFromMasks(ink, faint, opts));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push({ label: `${doc.name} / ${fixtureCase.id}`, before: a.boxes.length, after: b.boxes.length, a, b });
    }
  }
}
console.log(`共 ${totalCases} 个 case；零变化 ${totalCases - changed.length} 个，有变化 ${changed.length} 个`);
for (const c of changed) {
  console.log(`  ${c.label}: ${c.before} 框 → ${c.after} 框`);
  const n = Math.min(c.a.boxes.length, c.b.boxes.length);
  let diffs = 0;
  for (let i = 0; i < n; i += 1) if (JSON.stringify(c.a.boxes[i]) !== JSON.stringify(c.b.boxes[i])) diffs += 1;
  console.log(`    逐框差异 ${diffs} 处（含框数变化 ${Math.abs(c.a.boxes.length - c.b.boxes.length)}）`);
}

// ——— 2. 桥接抓到的当前图：真实 JS 链路（buildInkMask + segmentFromMasks）———
const PY_DECODE = `
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
ratio = min(1, 1600 / max(W, H))
w, h = max(1, round(W * ratio)), max(1, round(H * ratio))
if (w, h) != (W, H): im = im.resize((w, h), Image.BILINEAR)
open(out, 'wb').write(im.tobytes())
print(W, H, w, h)
`;
const currentMeta = path.join(DEBUG_DIR, 'current.json');
if (fs.existsSync(currentMeta)) {
  const meta = JSON.parse(fs.readFileSync(currentMeta, 'utf8'));
  const imagePath = path.join(DEBUG_DIR, meta.file);
  const rawPath = path.join(os.tmpdir(), 'candidate-current.rgb');
  const decoded = spawnSync('python3', ['-c', PY_DECODE, imagePath, rawPath], { encoding: 'utf8' });
  if (decoded.status === 0) {
    const [W, H, w, h] = decoded.stdout.trim().split(/\s+/).map(Number);
    const rgb = fs.readFileSync(rawPath);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p += 1) {
      rgba[p * 4] = rgb[p * 3];
      rgba[p * 4 + 1] = rgb[p * 3 + 1];
      rgba[p * 4 + 2] = rgb[p * 3 + 2];
      rgba[p * 4 + 3] = 255;
    }
    globalThis.document = {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: rgba }) })
      })
    };
    const mask = base.buildInkMask({ naturalWidth: W, naturalHeight: H }, 1600, { withFaint: false });
    const gapRow = Math.max(2, Math.round(mask.height * 0.008));
    const minSizeRow = Math.max(2, Math.round(mask.height * 0.015));
    const leftProfile = base.projectRows(mask.ink, mask.width, mask.height, 127, 299);
    const leftBands = base.findBands(leftProfile, { relInk: 0.15, minGap: gapRow, minSize: minSizeRow });
    console.log(`\n左联 findBands (分析图 ${mask.width}x${mask.height}, gapRow=${gapRow}):`);
    console.log('  ' + leftBands.map((b) => `[${b.start},${b.end}] h=${b.end - b.start}`).join('  '));
    globalThis.__CAND_DEBUG = true;
    const opts = {
      width: mask.width, height: mask.height, scale: mask.scale,
      imageWidth: W, imageHeight: H, layout: 'vertical', hasGrid: false
    };
    const a = normalize(base.segmentFromMasks(mask.ink, null, opts));
    const b = normalize(cand.segmentFromMasks(mask.ink, null, opts));
    console.log(`\n=== 当前图 ${path.basename(imagePath)} ${W}x${H} ===`);
    console.log(`原版 ${a.boxes.length} 框  →  候选版 ${b.boxes.length} 框`);
    for (const [tag, boxes] of [['原版', a.boxes], ['候选', b.boxes]]) {
      const left = boxes.filter((x) => x.x < W / 2).sort((p, q) => p.y - q.y);
      const right = boxes.filter((x) => x.x >= W / 2).sort((p, q) => p.y - q.y);
      console.log(`  ${tag}：左联 ${left.length} 框 / 右联 ${right.length} 框`);
      console.log(`    左联 y 起点 ${left.map((x) => x.y).join(', ')}`);
      console.log(`    左联 框高   ${left.map((x) => x.h).join(', ')}`);
    }
    const outPath = '/tmp/candidate-boxes.json';
    fs.writeFileSync(outPath, JSON.stringify({
      image: imagePath, imageWidth: W, imageHeight: H,
      before: a.boxes, after: b.boxes
    }, null, 2));
    console.log(`\n候选框已写入 ${outPath}`);
    fs.rmSync(rawPath, { force: true });
  }
} else {
  console.log('\n（未找到桥接落盘的 current.json，跳过当前图验证）');
}

console.log(`\n补丁源码副本：${candidatePath}（仅 /tmp，src/ 未改动）`);
