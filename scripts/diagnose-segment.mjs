/**
 * 单图切分离线诊断（只读项目源码，不修改 src/）。
 *
 * 用 Pillow 解码并缩放出分析图 RGBA，注入 mock 的 Image / canvas 后直接调用
 * 项目真实的 segmentCharacters —— 灰度化、Otsu、装裱边框检测、反色、投影、
 * 列带、字距、切分、异常块过滤全部走生产代码。唯一近似是 canvas.drawImage
 * 的重采样由 Pillow BILINEAR 代替，可能带来 ±1px 级别的阈值/框边界差异。
 *
 * 用法：
 *   node scripts/diagnose-segment.mjs <图片路径> [选项]
 *   --layout vertical|horizontal   版面，默认 vertical
 *   --grid                         按有格字帖（会算 faint 格线掩码，较慢）
 *   --out <路径>                   框叠加图，默认 /tmp/segment-diag-<时间戳>.png
 *
 * 输出：逐层中间量、每个字框的原图坐标、带编号的框叠加图。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_SIZE = 1600;
const INK_RATIO = 0.15;
const GAP_RATIO = 0.008;
const MIN_SIZE_RATIO = 0.015;

const PY_DECODE = `
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
ratio = min(1, ${MAX_SIZE} / max(W, H))
w, h = max(1, round(W * ratio)), max(1, round(H * ratio))
if (w, h) != (W, H):
    im = im.resize((w, h), Image.Resampling.BILINEAR)
open(out, 'wb').write(im.tobytes())
print(W, H, w, h)
`;

const PY_DRAW = `
import json, sys
from PIL import Image, ImageDraw, ImageFont
src, meta, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(meta))
im = Image.open(src).convert('RGB')
d = ImageDraw.Draw(im)
try:
    font = ImageFont.load_default(size=max(12, im.width // 45))
except TypeError:
    font = ImageFont.load_default()
for i, b in enumerate(data['boxes'], 1):
    x, y, w, h = b['x'], b['y'], b['w'], b['h']
    d.rectangle([x, y, x + w, y + h], outline=(220, 30, 30), width=3)
    label = str(i)
    ty = max(0, y - getattr(font, 'size', 14) - 2)
    d.rectangle([x, ty, x + len(label) * getattr(font, 'size', 14) * 0.7 + 6,
                 ty + getattr(font, 'size', 14) + 4], fill=(220, 30, 30))
    d.text((x + 3, ty + 1), label, fill=(255, 255, 255), font=font)
im.save(out)
print(out)
`;

const args = process.argv.slice(2);
const imagePath = args.find((a) => !a.startsWith('--'));
if (!imagePath) {
  console.error('用法: node scripts/diagnose-segment.mjs <图片路径> [--layout vertical|horizontal] [--grid] [--out /tmp/xxx.png]');
  process.exit(1);
}
const resolved = path.resolve(imagePath);
if (!fs.existsSync(resolved)) {
  console.error(`找不到图片: ${resolved}`);
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const layout = opt('--layout', 'vertical');
const hasGrid = args.includes('--grid');
const stamp = `${process.pid}-${Date.now()}`;
const rawPath = path.join(os.tmpdir(), `segment-diag-${stamp}.rgba`);
const metaPath = path.join(os.tmpdir(), `segment-diag-${stamp}.json`);
const inkPath = path.join(os.tmpdir(), `segment-diag-${stamp}.ink.bin`);
const outPath = opt('--out', path.join(os.tmpdir(), `segment-diag-${stamp}.png`));
// 位压缩（MSB first），与 scripts/fixtures/segment/*.ink.bin 同格式，便于逐像素比对
const packBits = (bits) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
};

const decode = spawnSync('python3', ['-c', PY_DECODE, resolved, rawPath], { encoding: 'utf8' });
if (decode.status !== 0) {
  console.error('图片解码失败:', decode.stderr.trim());
  process.exit(1);
}
const [W, H, w, h] = decode.stdout.trim().split(/\s+/).map(Number);
// RGB → RGBA：canvas.getImageData 返回 4 通道；与夹具生成脚本同样保持 RGB 插值路径
const rgb = fs.readFileSync(rawPath);
const rgba = new Uint8ClampedArray(w * h * 4);
for (let p = 0; p < w * h; p += 1) {
  rgba[p * 4] = rgb[p * 3];
  rgba[p * 4 + 1] = rgb[p * 3 + 1];
  rgba[p * 4 + 2] = rgb[p * 3 + 2];
  rgba[p * 4 + 3] = 255;
}

// —— 浏览器 API mock：让 src/utils/segment.js 原封不动地在 Node 里跑 ——
globalThis.Image = class {
  constructor() {
    this.naturalWidth = W;
    this.naturalHeight = H;
    this._src = '';
  }
  set src(value) {
    this._src = value;
    queueMicrotask(() => {
      if (this.onload) this.onload();
    });
  }
  get src() {
    return this._src;
  }
};
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`意外的 createElement: ${tag}`);
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: rgba })
      })
    };
  }
};

const seg = await import('../src/utils/segment.js');

// —— 逐层中间量（复算时参数与 segmentFromMasks 保持一致）——
const gray = new Uint8Array(w * h);
const hist = new Uint32Array(256);
for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
  const g = ((rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000) | 0;
  gray[p] = g;
  hist[g] += 1;
}
const fullThreshold = seg.otsuThreshold(hist, w * h);
const border = seg.detectContentBorder(gray, w, h, fullThreshold);
const mask = seg.buildInkMask({ naturalWidth: W, naturalHeight: H }, MAX_SIZE, { withFaint: false });
const ink = mask.ink;
let inkCount = 0;
for (let i = 0; i < ink.length; i += 1) inkCount += ink[i];
const region = border ? (border.x1 - border.x0) * (border.y1 - border.y0) : w * h;

const gapCol = Math.max(2, Math.round(w * GAP_RATIO));
const gapRow = Math.max(2, Math.round(h * GAP_RATIO));
const minSizeCol = Math.max(2, Math.round(w * MIN_SIZE_RATIO));
const minSizeRow = Math.max(2, Math.round(h * MIN_SIZE_RATIO));
const colProfile = seg.projectColumns(ink, w, h);
const rawColBands = seg.findBands(colProfile, { relInk: INK_RATIO, minGap: gapCol, minSize: minSizeCol });
const rowBands = seg.findBands(seg.projectRows(ink, w, h), {
  relInk: INK_RATIO, minGap: gapRow, minSize: minSizeRow
});
const wideSearch = seg.needsWidePitchSearch(rawColBands, w);
const pitchEstimate = seg.estimatePitch(colProfile, 0.08, wideSearch ? 0.55 : 0.4);
const singleWide = seg.isSingleWideColumn(rawColBands, rowBands, w, pitchEstimate.pitch);
const strokePitch = seg.isStrokeLevelPitch(rawColBands, w, pitchEstimate.pitch);

const fmtBands = (bands) => bands.map((b) => `[${b.start},${b.end}]`).join(' ') || '(无)';
console.log(`\n图片      ${path.basename(resolved)}  ${W}x${H}  →  分析图 ${w}x${h} (scale ${mask.scale.toFixed(4)})`);
console.log(`版面      ${layout}${hasGrid ? ' / 有格' : ' / 无格'}`);
console.log('— 掩码 —');
console.log(`全图 Otsu 阈值 ${fullThreshold}；命中后纸区阈值 ${mask.threshold}`);
console.log(`装裱边框  ${border ? `命中 ${JSON.stringify(border)}` : '未命中'}`);
console.log(`墨迹占比  ${(inkCount / region * 100).toFixed(1)}%  ${inkCount > region * 0.6 ? '→ 触发反色（黑底白字）' : '→ 不反色'}`);
console.log('— 列带与字距 —');
console.log(`原始列带  ${fmtBands(rawColBands)}  (${rawColBands.length} 条)`);
console.log(`行带      ${fmtBands(rowBands)}  (${rowBands.length} 条)`);
console.log(`字距搜索上限 ${wideSearch ? '0.55W（双联形态）' : '0.4W'}；pitch=${pitchEstimate.pitch} score=${pitchEstimate.score.toFixed(3)}`);
console.log(`单列大字特写 ${singleWide ? '命中 → pitch 置 0' : '否'}；笔画级伪字距 ${strokePitch ? '命中 → pitch 置 0' : '否'}`);

let maskInfo = null;
const result = await seg.segmentCharacters('mock://diagnose', {
  layout,
  hasGrid,
  onMask: (m) => {
    maskInfo = m;
    fs.writeFileSync(inkPath, packBits(m.ink));
  }
});
const boxes = (result.boxes || []).map((b) => ({
  x: Math.round(b.x), y: Math.round(b.y),
  w: Math.round(b.width), h: Math.round(b.height)
}));
console.log('— 结果 —');
console.log(`strategy=${result.strategy || 'projection'}  layout=${result.layout}  failed=${Boolean(result.failed)}  columns=${result.columns}  框数=${boxes.length}${result.reason ? `  reason=${result.reason}` : ''}`);
if (result.gridKind) console.log(`格线类型 ${result.gridKind}  step=${JSON.stringify(result.gridStep)}`);
console.log(`onMask 传回 ${maskInfo ? `${maskInfo.width}x${maskInfo.height}` : '无'}`);
boxes.forEach((b, i) => console.log(`  #${String(i + 1).padStart(2)}  x=${String(b.x).padStart(4)} y=${String(b.y).padStart(4)} w=${String(b.w).padStart(4)} h=${String(b.h).padStart(4)}`));

fs.writeFileSync(metaPath, JSON.stringify({ image: resolved, layout, hasGrid, boxes }));
const draw = spawnSync('python3', ['-c', PY_DRAW, resolved, metaPath, outPath], { encoding: 'utf8' });
if (draw.status !== 0) {
  console.error('叠加图生成失败:', draw.stderr.trim());
} else {
  console.log(`\n框叠加图  ${draw.stdout.trim()}`);
}
fs.rmSync(rawPath, { force: true });
console.log(`框坐标    ${metaPath}`);
console.log(`墨迹掩码  ${inkPath}  (与 fixtures 同格式，可逐像素比对)`);
