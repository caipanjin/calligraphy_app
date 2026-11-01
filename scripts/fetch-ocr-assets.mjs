#!/usr/bin/env node
/**
 * 准备离线 OCR 资源：tesseract worker、wasm core、中英文语言包。
 *
 * 这些文件体积较大（合计约 12MB）且可由 node_modules + 公共镜像重新生成，
 * 因此不进 git，改为在 dev/build 前自动准备（见 package.json 的 predev / prebuild）。
 *
 * 用法：
 *   node scripts/fetch-ocr-assets.mjs          # 缺失时补全，已存在则跳过
 *   node scripts/fetch-ocr-assets.mjs --force  # 强制重新下载
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');
const force = process.argv.includes('--force');

// 语言包使用 tessdata_fast（约 3.5MB）；如需高精度可换成 4.0.0（约 29MB）
const TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0_fast';

const copies = [
  {
    from: join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
    to: join(outDir, 'worker.min.js'),
    minSize: 50 * 1024
  },
  {
    from: join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'),
    to: join(outDir, 'core', 'tesseract-core-simd-lstm.wasm.js'),
    minSize: 1024 * 1024
  },
  {
    from: join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'),
    to: join(outDir, 'core', 'tesseract-core-lstm.wasm.js'),
    minSize: 1024 * 1024
  }
];

// 只保留简体中文：加入 eng 会让 tesseract 在中文失败时回退成拉丁字母，
// 出现「毛笔字识别成一串英文」的现象（实测见 openspec/changes/ocr-accuracy-tuning.md）
const downloads = [{ lang: 'chi_sim', minSize: 500 * 1024 }];

const needsWork = (file, minSize) => force || !existsSync(file) || statSync(file).size < minSize;

const ensureDir = (file) => mkdirSync(dirname(file), { recursive: true });

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const copyAssets = () => {
  for (const { from, to, minSize } of copies) {
    if (!needsWork(to, minSize)) {
      console.log(`[ocr-assets] 跳过 ${to.replace(root + '/', '')}（已存在）`);
      continue;
    }
    if (!existsSync(from)) {
      throw new Error(`缺少来源文件：${from}\n请先执行 npm install`);
    }
    ensureDir(to);
    copyFileSync(from, to);
    console.log(`[ocr-assets] 复制 ${from.replace(root + '/', '')} -> ${to.replace(root + '/', '')}`);
  }
};

const downloadLang = async ({ lang, minSize }) => {
  const to = join(outDir, 'lang', `${lang}.traineddata.gz`);
  if (!needsWork(to, minSize)) {
    console.log(`[ocr-assets] 跳过 lang/${lang}.traineddata.gz（已存在）`);
    return;
  }
  const url = `${TESSDATA_BASE}/${lang}.traineddata.gz`;
  console.log(`[ocr-assets] 下载 ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 ${url}：HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < minSize) {
    throw new Error(`下载内容异常 ${url}：${formatSize(buffer.length)}`);
  }
  ensureDir(to);
  writeFileSync(to, buffer);
  console.log(`[ocr-assets] 写入 lang/${lang}.traineddata.gz（${formatSize(buffer.length)}）`);
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  copyAssets();
  for (const item of downloads) {
    await downloadLang(item);
  }
  console.log(`[ocr-assets] 完成，资源目录：${outDir.replace(root + '/', '')}/`);
};

main().catch((error) => {
  console.error('[ocr-assets] 失败：', error.message);
  console.error('[ocr-assets] 缺少离线识别资源时，文字识别功能将无法使用。');
  process.exit(1);
});
