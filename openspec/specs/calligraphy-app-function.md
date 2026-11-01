# 书法临摹助手 - 功能梳理文档

> 生成日期: 2026-05-28

## 目录

1. [项目概况](#1-项目概况)
2. [技术架构](#2-技术架构)
3. [模块与组件树](#3-模块与组件树)
4. [核心功能详解](#4-核心功能详解)
5. [数据流与状态管理](#5-数据流与状态管理)
6. [OCR 文字识别子系统](#6-ocr-文字识别子系统)
7. [用户交互矩阵](#7-用户交互矩阵)
8. [已知问题与风险](#8-已知问题与风险)
9. [待扩展方向](#9-待扩展方向)

---

## 1. 项目概况

| 属性 | 说明 |
|------|------|
| 项目名称 | 书法临摹助手 (Calligraphy App) |
| App ID | `com.caipanjin.calligraphy` |
| 类型 | 跨平台移动应用 (iOS / Android) |
| 构建工具 | Vite 4.2 |
| 前端框架 | React 18.3.1 |
| 移动壳 | Capacitor 6.2.0 |
| 开发语言 | JavaScript (ES Module) |
| 目标用户 | 书法爱好者、书法学习者 |
| 运行方式 | Web 开发 (`npm run dev`)、构建 (`npm run build`) 后通过 Capacitor 打入原生包 |

---

## 2. 技术架构

```
┌──────────────────────────────────────────────────┐
│               Capacitor 原生壳                    │
│        (iOS / Android WebView 容器)               │
├──────────────────────────────────────────────────┤
│           React 18 SPA (Vite 构建)                │
│                                                  │
│  ┌──────────┐ ┌───────────┐ ┌─────────────────┐ │
│  │ App.jsx  │ │ OCRResults│ │ CharacterSelector│ │
│  │ (状态中枢)│ │ (识别结果)│ │  (字符选择器)    │ │
│  └──────────┘ └───────────┘ └─────────────────┘ │
│  ┌──────────┐ ┌───────────┐                     │
│  │ImageViewer│ │RecentImages│                    │
│  │(图片查看器)│ │ (最近图片) │                    │
│  └──────────┘ └───────────┘                     │
├──────────────────────────────────────────────────┤
│  工具模块: src/utils/ocr.js                      │
│  (图片预处理 / tesseract.js 调用 / 结果分组)      │
├──────────────────────────────────────────────────┤
│  持久化层: IndexedDB                             │
│  数据库名: calligraphyImages, 版本: 1            │
│  对象仓库: images (keyPath: id)                  │
└──────────────────────────────────────────────────┘
```

### 2.1 依赖清单

| 包名 | 版本 | 用途 |
|------|------|------|
| `react` / `react-dom` | 18.3.1 | 核心 UI 框架 |
| `@capacitor/core` | 6.2.0 | 跨平台原生能力桥接 |
| `@capacitor/cli` | 6.2.0 | Capacitor 命令行工具 |
| `@capacitor/ios` | 6.2.0 | iOS 平台支持 |
| `@capacitor/android` | 6.2.0 | Android 平台支持 |
| `vite` | 4.2.0 | 前端构建工具 |
| `@vitejs/plugin-react` | 3.1.0 | Vite React 插件 |
| `react-icons` | 5.4.0 | 图标库 (Font Awesome) |
| `react-image-magnifiers` | 1.4.0 | 图片放大镜组件 |
| `tesseract.js` | 5.1.1 | 客户端 OCR 文字识别 |
| `@studyzy/openspec-cn` | 1.2.0-2 | OpenSpec 中文规范工具 (dev) |

---

## 3. 模块与组件树

```
main.jsx                  # 入口: 挂载 React 根节点
└── App.jsx               # 状态中枢 (373行)
    ├── RecentImages      # 最近图片管理 (171行)
    │   ├── 图片缩略图列表
    │   ├── 文件上传 input
    │   └── 删除确认弹窗
    ├── ImageViewer       # 图片查看器 (50行)
    │   ├── Magnifier (放大镜)
    │   └── 透明点击捕获层
    ├── CharacterSelector # 字符选择器 (519行)
    │   ├── SVG 视图 (拖动平移)
    │   ├── 微调按钮 (上下左右, 步长 2px)
    │   ├── 缩放按钮 (因子 1.05)
    │   ├── 上/下一个字符跳转按钮
    │   ├── 相邻字符预览缩略图 (前2 + 当前 + 后2)
    │   └── 返回完整图片按钮
    └── OCRResults        # OCR 识别结果 (167行)
        ├── 加载进度条
        ├── 错误提示 + 手动选择入口
        ├── 图片标注框 (bounding box)
        └── 文字识别列表 (按行分组)

src/utils/ocr.js          # OCR 工具函数 (142行)
├── preprocessImage()     # 图片预处理
├── recognizeText()       # tesseract.js 识别调用
└── groupWordsByLine()    # 按行分组识别结果
```

### 3.1 组件职责矩阵

| 组件 | 状态拥有 | 副作用 | 行数 |
|------|---------|--------|------|
| `App.jsx` | image, selectedCharacter, recentImages, db, showOCR 等 10+ 状态 | IndexedDB 初始化、图片加载、OCR 触发 | 393 |
| `RecentImages.jsx` | showRecentImages, showDeleteModal, deleteIndex | 长按计时器 | 171 |
| `ImageViewer.jsx` | 无内部状态 (纯展示) | 无 | 50 |
| `CharacterSelector.jsx` | isDragging, dragStart | 拖动事件绑定 (鼠标 + 触摸) | 519 |
| `OCRResults.jsx` | ocrResult, loading, progress, error, imageSize | OCR 异步识别 + 取消机制 | 167 |
| `ocr.js` | 无 (纯函数) | Canvas 图片处理、tesseract.js 调用 | 142 |

---

## 4. 核心功能详解

### 4.1 图片上传与管理

**流程**:

```
用户选择文件 (input[type=file].multiple)
    │
    ├── 格式校验: JPEG / PNG / GIF / WebP
    ├── 数量限制: 最多 5 个文件
    ├── 内容校验: base64 格式有效性检查
    │   ├── 检查 data: 前缀
    │   ├── 检查 base64 部分长度 >= 100
    │   └── 正则校验 base64 字符集
    │
    ├── FileReader.readAsDataURL() 转换
    └── setImageWithRecent() 保存
        ├── IndexedDB: 写入 current 主记录
        ├── IndexedDB: 去重 + 排序写入 recent_0..recent_4
        ├── 触发 setShowRecentImages(true)
        └── 触发 setShowOCR(true) → OCR 识别
```

**最近图片 (Recent Images)**:
- 存储上限: 5 张
- 去重逻辑: 重复图片移回列表最前
- 持久化: 刷新/重新打开不丢失 (IndexedDB)
- 删除: 长按 500ms 弹出确认框 → 重排索引

### 4.2 图片查看

**ImageViewer 组件**:

- 使用 `react-image-magnifiers` 的 `Magnifier` 组件实现悬停放大
- 原图和放大图使用同一张图 (`imageSrc = largeImageSrc`)
- 覆盖透明点击层 (`z-index: 1`) 捕获点击坐标 → 进入字符选择

**图片状态依赖**:
- `image` 为 null → 隐藏整个容器 (`display: none`)
- `selectedCharacter` 不为 null → 隐藏 Magnifier (进入字符视图)

### 4.3 字符选择器

这是整个应用最复杂的组件 (519行)，核心机制是通过 **SVG viewBox** 实现图片局部裁剪显示。

**初始选择计算** (`handleCharacterClick` in App.jsx):

```
点击坐标 (clientX, clientY)
    │
    ├── 获取图片 DOM 位置 (getBoundingClientRect)
    ├── 相对坐标: clickX = clientX - rect.left
    │
    ├── 字符框尺寸:
    │   charWidth  = effectiveWidth × 0.25
    │   charHeight = charWidth × 1.0 (正方形)
    │   最小高度   = effectiveHeight × 0.1
    │
    ├── 缩放比例:
    │   scaleX = naturalWidth  / rect.width
    │   scaleY = naturalHeight / rect.height
    │
    └── viewBox 计算:
        x = (clickX - charWidth/2)  × scaleX
        y = (clickY - charHeight/2) × scaleY
        w = charWidth  × scaleX
        h = charHeight × scaleY
```

**SVG 视图实现**:

```jsx
<svg viewBox={`${x} ${y} ${w} ${h}`}>
  <image href={src} width={naturalWidth} height={naturalHeight} />
</svg>
```

**交互能力**:

| 操作 | 实现 | 参数 |
|------|------|------|
| 微调 (上下左右) | viewBox.x/y ± ADJUST_STEP | 步长 = 2px |
| 缩放 (放大/缩小) | viewBox.w/h ×/÷ DEFAULT_ZOOM_FACTOR | 因子 = 1.05 |
| 拖动平移 | onMouseDown/onMouseMove/onMouseUp 计算 dx/dy | 基于 VIEWPORT_SIZE=360 比例换算 |
| 上一字符 | `getPreviousCharacterPosition()` 递归跳转 | 按列排版逻辑 |
| 下一字符 | `getNextCharacterPosition()` 递归跳转 | 按列排版逻辑 |
| 缩略图点击 | 5 个预览缩略图 (前2/前1/当前/后1/后2) | 点击直接设置 viewBox |

**字符跳转逻辑** (按竖排版设计，适合中文书法):

```
getNextCharacterPosition:
  1. newY += charHeight (向下走一字符)
  2. 若 newY >= imageHeight: 走到列底，newX -= charWidth, newY = 0 (左移一列)
  3. 若超出左边界 → 返回 {x:-1, y:-1} (隐藏)
  4. 递归 step-1 次

getPreviousCharacterPosition:
  1. newY -= charHeight (向上走一字符)
  2. 若 newY + charHeight/2 < 0: 走到列顶，newX += charWidth (右移一列)
  3. 若超出右边界 → 返回 {x:-1, y:-1} (隐藏)
  4. 递归 step-1 次
```

**触摸支持**:
- `onTouchStart` / `onTouchMove` / `onTouchEnd` 实现与鼠标拖动等效的操作
- `onTouchMove` 调用 `e.preventDefault()` 阻止页面滚动

---

## 5. 数据流与状态管理

### 5.1 状态全景图

所有状态集中在 `App.jsx`，通过 props 向下传递：

```
App.jsx 状态清单:
┌─────────────────────────────────────────┐
│ db                  IndexedDB 实例       │ ← useEffect 初始化
│ image               string | null       │ ← 从 IndexedDB 或上传加载
│ selectedCharacter   object | null       │ ← 点击图片或 OCR 结果触发
│   ├── src           string             │
│   ├── width         number             │
│   ├── height        number             │
│   └── viewBox       {x,y,width,height} │
│ recentImages        string[]           │ ← IndexedDB 同步
│ showRecentImages    boolean            │ ← setImageWithRecent 设为 true
│ showOCR             boolean            │ ← setImageWithRecent 设为 true
│ charHeightRef       useRef(0)          │ ← handleCharacterClick 计算
│ imageRef            useRef(null)       │ ← ImageViewer 绑定
└─────────────────────────────────────────┘
```

### 5.2 数据流图

```
                ┌──────────────┐
                │   用户操作    │
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  上传图片文件     点击最近图片     点击图片
        │              │              │
        ▼              ▼              ▼
  handleImageUpload  setImage    handleCharacterClick
        │              │              │
        ▼              ▼              ▼
  base64 校验      setImageWithRecent  计算 viewBox
        │              │              │
        └──────┬───────┘              │
               ▼                      ▼
        setImageWithRecent      setSelectedCharacter
               │                      │
        ┌──────┼──────┐              │
        ▼      ▼      ▼              ▼
    IndexedDB  state  showOCR   CharacterSelector
    持久化    更新    触发      显示 SVG 视图
               │
        ▼
    OCRResults
    (tesseract.js 识别)
               │
               ▼
      onSelectCharacter
               │
               ▼
      setSelectedCharacter
    (设定 viewBox 为识别框位置)
```

### 5.3 IndexedDB Schema

```
数据库名: calligraphyImages
版本: 1

对象仓库: images
  键路径: keyPath = "id"

存储条目:
  { id: "current",    url: "data:image/jpeg;base64,..." }
  { id: "recent_0",   url: "data:image/jpeg;base64,..." }
  { id: "recent_1",   url: "data:image/png;base64,..."  }
  { id: "recent_2",   url: "data:image/webp;base64,..." }
  { id: "recent_3",   url: "mages\n  键路径: keyPath = \"id\"\n\n存储条目:\n  { id: \"current\",    url: \"data:image/jpeg;base64,...\" }\n  { id: \"recent_0\",   url: \"data:image/jpeg;base64,...\" }\n  { id: \"recent_1\",   url: \"data:image/png;base64,...\"  }\n  { id: \"recent_2\",   url: \"data:image/webp;base64,...\" }\n  { id: \"recent_3\",   url: \"..." }\n  { id: \"recent_4\",   url: \"..." }\n\n容量上限: 1 个 current + 最多 5 个 recent\n```\n\n**初始化逻辑**:\n- `onupgradeneeded`: 创建 `images` 对象仓库\n- `onsuccess`: 设置 `db` 状态 → 触发读回 `current` 图片和 `recent` 列表\n- `onerror`: 1 秒后自动重试连接\n- `onblocked`: 打印警告\n\n**删除逻辑**:\n1. 先从 UI 数组移除\n2. 删除对应 `recent_{index}` 记录\n3. 若还有图片 → 清除所有 `recent_*` 后重新写入 (索引重整)\n4. 若没有图片 → 清除所有 `recent_*`\n\n---\n\n## 6. OCR 文字识别子系统\n\n### 6.1 模块结构\n\n```\nsrc/utils/ocr.js                     OCRResults.jsx\n┌────────────────────┐               ┌──────────────────┐\n│ preprocessImage()  │               │ useEffect 触发    │\n│ ├─ 尺寸限制 ≤2000  │               │ ├─ preprocessImage│\n│ ├─ 灰度化 (加权)  │──────────────▶│ ├─ recognizeText  │\n│ └─ 对比度增强      │               │ └─ groupWordsByLine│\n│                    │               │                   │\n│ recognizeText()    │               │ 状态:             │\n│ ├─ tesseract.js    │               │ ├─ ocrResult      │\n│ ├─ chi_sim+eng     │──────────────▶│ ├─ loading        │\n│ ├─ progress 回调   │               │ ├─ progress       │\n│ └─ words 过滤清洗   │               │ ├─ error          │\n│                    │               │ └─ imageSize      │\n│ groupWordsByLine() │               │                   │\n│ ├─ 按 y0 排序      │──────────────▶│ 渲染:             │\n│ ├─ yThreshold=20   │               │ ├─ 加载进度条     │\n│ └─ 按行输出        │               │ ├─ 识别失败提示   │\n└────────────────────┘               │ ├─ Bounding Box  │\n                                     │ └─ 文字列表       │\n                                     └──────────────────┘\n```\n\n### 6.2 图片预处理 (`preprocessImage`)\n\n```\n输入: base64 图片数据\n  │\n  ├── 加载图片 (new Image)\n  ├── 尺寸限制: 最长边 ≤ 2000px\n  │\n  ├── 步骤1: 灰度化\n  │   Gray = 0.299×R + 0.587×G + 0.114×B (加权法)\n  │\n  ├── 步骤2: 对比度增强\n  │   normalized = (pixel - min) / (max - min)\n  │   enhanced    = normalized^1.5 × 255 (Gamma 校正)\n  │\n  └── 输出: JPEG canvas (quality=0.9)\n```\n\n### 6.3 文字识别 (`recognizeText`)\n\n```\n输入: 预处理后的图片\n  │\n  ├── tesseract.recognize(imageData, 'chi_sim+eng', { logger })\n  │   ├── 识别语言: 简体中文 + 英文\n  │   ├── logger: 当 status === 'recognizing text' 时回调 progress\n  │\n  ├── 结果清洗:\n  │   ├── 过滤空白文字 (text.trim().length > 0)\n  │   ├── 提取 bbox: { x0, y0, x1, y1 } (边界框坐标)\n  │   └── 保留 confidence (置信度)\n  │\n  └── 输出: { words: [...], text: \"...\" }\n```\n\n### 6.4 行分组 (`groupWordsByLine`)\n\n```\n输入: 识别出的文字列表 [{ text, bbox, confidence }]\n  │\n  ├── 按 y0 坐标排序\n  ├── 遍历每个文字:\n  │   ├── 检查是否有已有行其 avgY 与 word.y0 差值 < 20px\n  │   ├── 有 → 加入该行，更新 avgY\n  │   └── 无 → 新建一行\n  │\n  └── 输出: [{ words: [...], avgY }] (按 y 排序)\n```\n\n### 6.5 OCR 生命周期管理\n\n```\n图片变化 (image state 更新)\n  │\n  ├── 触发 OCRResults useEffect\n  ├── isCancelled = false\n  ├── 异步执行识别\n  │\n  ├── 组件卸载或 image 再次变化时:\n  │   └── cleanup: isCancelled = true\n  │       (跳过 setState，防止内存泄漏)\n  │\n  └── 识别完成后:\n      ├── 成功 → 显示 words list + bounding boxes\n      └── 失败 → 显示错误 + \"手动选择字符\" 按钮\n```\n\n### 6.6 OCR → 字符选择衔接\n\n用户点击识别结果中的文字时:\n\n```\nhandleWordClick(word)\n  │\n  ├── 取 bbox: { x0, y0, x1, y1 }\n  ├── 加 padding: 10px\n  │\n  └── 构造 selectedCharacter:\n      src     = image\n      width   = imageSize.width\n      height  = imageSize.height\n      viewBox = {\n        x: Math.max(0, x0 - padding),\n        y: Math.max(0, y0 - padding),\n        w: (x1 - x0) + padding * 2,\n        h: (y1 - y0) + padding * 2\n      }\n  │\n  └── 传给 CharacterSelector，展示 SVG 裁剪视图\n```\n\n---\n\n## 7. 用户交互矩阵\n\n| 场景 | 触发方式 | 目标组件 | 响应 |\n|------|---------|---------|------|\n| 上传书法图片 | 点击上传按钮 → 选择文件 | App.jsx | 校验 → 存 IndexedDB → OCR |\n| 切换图片 | 点击最近图片缩略图 | RecentImages | 更新 image → 触发 OCR |\n| 删除图片 | 长按缩略图 500ms → 确认 | RecentImages | 从 IndexedDB 删除 → 刷新列表 |\n| 选择字符 | 点击图片上任意位置 | ImageViewer → App.jsx | 计算 viewBox → 打开 CharacterSelector |\n| 微调区域 | 点击方向键 | CharacterSelector | viewBox.x/y ± 2px |\n| 拖动区域 | 鼠标/手指拖动 SVG | CharacterSelector | 实时更新 viewBox |\n| 缩放区域 | 点击 +/- 按钮 | CharacterSelector | viewBox 缩放因子 1.05 |\n| 跳转字符 | 点击上下字符按钮 | CharacterSelector | 按竖排逻辑递归跳转 |\n| 预览跳转 | 点击缩略图 | CharacterSelector | 直接设置对应 viewBox |\n| 返回全图 | 点击\"返回完整图片\" | CharacterSelector | 关闭选择器，恢复 Magnifier |\n| OCR 选字 | 点击识别结果文字/边界框 | OCRResults | 设定 viewBox 为识别框 → 打开选择器 |\n| 关闭 OCR | 点击 × 按钮 | OCRResults | 隐藏面板，保留手动选字 |\n\n---\n\n## 8. 已知问题与风险\n\n### 8.1 技术问题\n\n| 问题 | 影响 | 原因 |\n|------|------|------|\n| `react-image-magnifiers` peer dependency 警告 | 不影响功能 | React 版本不完全匹配 |\n| OCR 对书法字体识别准确率偏低 | 识别结果可能不完整 | 书法字体多样，tesseract.js 训练数据以印刷体为主 |\n| OCR 识别速度较慢 | 大图需要等待数秒 | 纯客户端计算，受浏览器/设备性能限制 |\n| 放大镜组件在字符选择时被隐藏 | 进入选择器后无法放大 | 设计决策：二者互斥 |\n| 触摸拖动可能阻止页面滚动 | `e.preventDefault()` | CharacterSelector 为保持拖动流畅 |\n\n### 8.2 架构风险\n\n- **状态耦合度高**: 10+ 状态集中在 App.jsx，扩展时需重构\n- **IndexedDB 删除逻辑脆弱**: 删除时清除所有 `recent_*` 后重新写入，非原子操作\n- **OCR 为每次图片变更触发**: 频繁切换图片会产生大量识别请求\n- **无路由机制**: 单页全屏应用，无法深层链接\n\n---\n\n## 9. 待扩展方向\n\n### 9.1 短期 (提升现有体验)\n\n| 方向 | 优先级 | 说明 |\n|------|--------|------|\n| OCR 识别性能优化 | 高 | 增加 Web Worker 后台识别，减少主线程阻塞 |\n| 图片旋转支持 | 中 | 支持旋转查看横排书法作品 |\n| 字符区域调整手柄 | 中 | 在 SVG 视图上加拖拽手柄调整选择框大小 |\n| 暗色模式 | 低 | CSS 变量实现主题切换 |\n\n### 9.2 中期 (扩展功能)\n\n| 方向 | 优先级 | 说明 |\n|------|--------|------|\n| 临摹对比功能 | 高 | 叠加透明图层，对齐原贴与自己摹写的差异 |\n| 整幅作品自动分割 | 高 | 利用 OCR 的 bbox 或图像分割算法自动拆出所有字 |\n| 导出/分享功能 | 中 | 导出临摹对比图或识别结果 |\n| 收藏夹功能 | 中 | 收藏喜欢的字帖，持久化存储 |\n\n### 9.3 长期 (架构升级)\n\n| 方向 | 优先级 | 说明 |\n|------|--------|------|\n| 状态管理重构 | 中 | 引入 Zustand 或 useReducer 解耦 App.jsx |\n| 路由机制 | 低 | 引入 React Router 实现多页面导航 |\n| PWA 支持 | 低 | 添加 Service Worker 实现离线使用和安装 |\n| 服务端 OCR | 低 | 可选后端 OCR 提升识别准确率 |\n\n---\n\n## 附录: 文件清单\n\n```\n项目根目录\n├── package.json                 # 项目依赖与脚本\n├── capacitor.config.json        # Capacitor 配置\n├── vite.config.js               # Vite 构建配置 (推测存在)\n├── .gitignore                   # Git 忽略规则\n│\n├── src/                         # 前端源码\n│   ├── main.jsx                 # 入口: ReactDOM.createRoot\n│   ├── App.jsx                  # 状态中枢: 状态+业务逻辑 (393行)\n│   ├── index.css                # 全局样式 (186行)\n│   ├── components/\n│   │   ├── RecentImages.jsx     # 最近图片组件 (171行)\n│   │   ├── ImageViewer.jsx      # 图片查看器 (50行)\n│   │   ├── CharacterSelector.jsx # 字符选择器 (519行)\n│   │   └── OCRResults.jsx       # OCR 结果展示 (167行)\n│   └── utils/\n│       └── ocr.js               # OCR 工具函数 (142行)\n│\n├── android/                     # Android 原生壳\n├── ios/                         # iOS 原生壳\n│\n└── openspec/                    # OpenSpec 规范文档\n    ├── specs/\n    │   ├── calligraphy-app.md   # 项目规范\n    │   └── calligraphy-app-function.md  # 功能梳理文档 (本文件)\n    └── changes/\n        ├── project-analysis.md  # 初步梳理变更记录\n        └── archive/\n            └── 2026-03-18-ocr-text-recognition/\n                ├── proposal.md  # OCR 提案\n                ├── design.md    # OCR 设计\n                ├── tasks.md     # OCR 任务清单\n                └── specs/ocr-recognition/spec.md  # OCR 规范\n```\n"}