## Why

当前用户需要手动点击图片来选择要临摹的字符，操作繁琐且容易选不准。集成 OCR 文字识别可以自动识别图片中的书法文字，让用户快速选择要临摹的字，提升使用体验。

## What Changes

- 引入 tesseract.js 库进行 OCR 文字识别
- 新增图片预处理功能（灰度化、增强对比度）提高识别准确率
- 在图片上传后自动识别文字并标注可选字符区域
- 显示识别结果列表，用户点击即可选择字符
- 支持中英文识别

## Capabilities

### New Capabilities
- `ocr-recognition`: 自动识别书法图片中的文字，提供可选字符列表

### Modified Capabilities
- （无）

## Impact

- 新增依赖: tesseract.js
- 需要修改 App.jsx 增加 OCR 识别逻辑
- 可能新增 OCR 处理相关组件