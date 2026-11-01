# OCR 离线化与按需触发 - 变更记录

## 变更信息

- **变更名称**: ocr-offline-ondemand
- **变更类型**: 功能优化 / 缺陷修复
- **完成时间**: 2026-11-01
- **关联代码**: `src/utils/ocr.js`、`src/components/OCRResults.jsx`、`src/App.jsx`、`scripts/fetch-ocr-assets.mjs`

## 背景

OCR 子系统的代码虽然写完并归档（见 `archive/2026-03-18-ocr-text-recognition`），但存在两个致命缺陷，导致实际使用中必然失败：

1. `preprocessImage` 用 `Math.min(...grayValues)` 对整幅图灰度数组求极值，元素数超过约 25 万（≈500×500 像素）即抛 `RangeError: Maximum call stack size exceeded`；
2. 识别在“缩放后的预处理图”上进行，bbox 却按原图尺寸使用，图片大于 2000px 时标注框与点选区域整体错位。

此外，全部识别资源（worker / wasm core / 语言包）默认走 CDN，移动端离线不可用；且每次上传或切换图片都会自动触发识别。

## 完成的工作

### 1. 仓库基线修复

- 移除 `node_modules` 的版本跟踪（3667 个文件），恢复 `.gitignore` 规则
- 将此前未提交的 OCR 代码、样式、OpenSpec 文档整理为独立提交

### 2. OCR 缺陷修复

- 灰度极值改为单次遍历（4MP 图约 11ms），不再依赖数组展开
- `preprocessImage` 返回 `scale`，新增 `mapBboxToSource` 将 bbox 回算到原图坐标系
- 行分组阈值随 `scale` 折算，避免大图被误拆成过多行
- 行内按 `x0` 升序输出，修正“九永和年”这类乱序

### 3. 离线化

- `scripts/fetch-ocr-assets.mjs` 从 `node_modules` 复制 worker/core、从镜像下载 tessdata_fast 语言包到 `public/tesseract/`
- 资源不入 git（约 12MB），由 `predev` / `prebuild` 自动准备，可用 `npm run ocr:assets` 手动执行
- `createWorker` 显式指定 `workerPath` / `corePath` / `langPath` 指向本地，`cacheMethod: 'none'`
- 语言包选用 tessdata_fast（chi_sim 1.6MB + eng 1.9MB），如需高精度可切换到 4.0.0（约 29MB）

### 4. 可控与可观测

- 识别改为**按需触发**：`App.jsx` 新增“识别文字”按钮，上传/换图不再自动跑 OCR
- worker 单例复用 + 任务串行队列（tesseract 同一时刻只能处理一个任务）
- 结果按图片内容哈希缓存（最多 8 条），来回切图 0ms 命中
- 识别/初始化超时（120s / 90s），超时后销毁并重建 worker
- 错误分类为 `asset` / `timeout` / `no-text` / `unknown`，分别给出可操作提示与重试入口

## 验证结论

- 无头 Chrome 阻断全部外部域名解析（`MAP * ~NOTFOUND`）后仍可识别，证明资源完全本地化
- UI 全链路：上传 → 出现按钮 → 未点击不识别 → 点击后出结果（900×300 图约 1s，3 个文字 3 个标注框）→ 点字进入字符视图
- 缓存：首次 158ms，再次 0ms，文本一致
- `npm run build` 通过，`dist` 约 13MB（含 OCR 资源）

## 遗留

- 竖排书法仍按横排聚行，需在“整幅自动切字”中改为按列切分
- 书法字体识别准确率受限于 tesseract 印刷体模型
- 历史提交中仍残留 `node_modules` blob（`.git` 约 73MB），彻底瘦身需重写历史
