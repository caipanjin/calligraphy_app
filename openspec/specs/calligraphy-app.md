# 书法临摹助手 - 项目规范

## 1. 项目概述

- **项目名称**: 书法临摹助手 (Calligraphy App)
- **项目类型**: 跨平台移动应用 (iOS/Android)
- **核心功能**: 帮助用户临摹书法作品，支持图片上传、字符选择、导航和缩放查看
- **目标用户**: 书法爱好者、学习书法的用户

## 2. 技术栈

### 2.1 前端框架
- React 18.3.1
- Vite 4.2.0

### 2.2 移动端框架
- Capacitor 6.2.0
  - @capacitor/core
  - @capacitor/cli
  - @capacitor/ios
  - @capacitor/android

### 2.3 主要依赖
- react-image-magnifiers: 图片放大镜功能
- react-icons: 图标库
- 无 OCR 依赖：文字识别已移除（通用 OCR 对毛笔字无效，详见 changes/ocr-removed-projection-segmentation.md）

### 2.4 数据存储
- IndexedDB: 本地离线存储图片和历史记录
- 自动切字：纯前端投影算法（`src/utils/segment.js`），无模型、毫秒级、完全离线

## 3. 功能规范

### 3.1 核心功能

#### 3.1.1 图片上传
- 支持格式: JPEG, PNG, GIF, WebP
- 批量上传: 最多一次5个文件
- 数据验证: 检查文件类型和 base64 格式有效性

#### 3.1.2 图片浏览
- 显示当前选中的书法图片
- 放大镜功能: 支持鼠标悬停放大查看细节
- 点击图片任意位置选择要临摹的字符区域

#### 3.1.3 字符选择
- 点击图片后显示字符选择器
- 默认字符区域大小: 图片宽度的 25%
- 支持拖动查看不同区域

#### 3.1.4 字符导航
- 上/下/左/右 微调按钮 (步长 2px)
- 上一字符/下一字符 快捷按钮
- 放大/缩小 按钮 (缩放因子 1.05)
- 相邻字符预览缩略图 (前2个、当 前、后2个)

#### 3.1.5 最近图片管理
- 自动保存最近查看的图片到 IndexedDB
- 最多保存 5 张最近图片
- 支持长按删除图片
- 图片数据持久化，刷新页面不丢失

### 3.2 用户交互

| 操作 | 功能 |
|------|------|
| 点击上传按钮 | 选择图片文件 |
| 点击最近图片 | 切换显示图片 |
| 长按最近图片 | 弹出删除确认 |
| 点击图片 | 选择字符区域 |
| 拖动字符视图 | 平移查看区域 |
| 点击导航按钮 | 切换相邻字符 |

### 3.3 数据流

```
用户上传图片 → IndexedDB 存储 → 读取显示
     ↓
点击图片 → 计算字符区域 → 显示字符选择器
     ↓
字符选择器 → 导航/缩放/拖动 → 更新 viewBox
     ↓
返回按钮 → 关闭字符选择器
```

## 4. 项目结构

```
calligraphy_app/
├── src/
│   ├── main.jsx              # 应用入口
│   ├── App.jsx               # 主应用组件 (373行)
│   ├── index.css             # 全局样式
│   └── components/
│       ├── Library.jsx         # 字帖库（网格卡片 / 空状态 / 添加）
│       ├── PracticeView.jsx    # 临摹页（图片舞台 + 单字临摹 + 手势）
│       ├── SegmentSheet.jsx    # 自动切字底部抽屉
│       ├── SettingsView.jsx    # 设置页（外观 / 数据 / 关于）
│       └── Toast.jsx           # 轻提示
│   ├── utils/
│   │   ├── segment.js          # 投影切分（墨迹掩码 / 投影 / 字块）
│   │   └── charNav.js          # 竖排字符导航（纯函数）
│   └── index.css               # 设计系统（令牌 + 组件样式 + 双主题）
├── docs/screens/             # 界面截图
├── ios/                      # iOS 原生项目
├── android/                  # Android 原生项目
├── capacitor.config.json     # Capacitor 配置
├── package.json              # 依赖配置
├── vite.config.js            # Vite 配置
└── openspec/                 # OpenSpec 规范目录
    ├── specs/                # 项目规范
    └── changes/              # 变更记录
```

## 5. 组件说明

### 5.0 信息架构

```
字帖库（Tab） ──点击卡片──▶ 临摹页 ──轻触图片──▶ 单字临摹
     │                        │
     │                        └─识别文字─▶ OCR 抽屉 ──点字──▶ 单字临摹
     └─设置（Tab）：外观 / 数据 / 关于
```

- 底部 Tab：字帖 / 设置；临摹页为全屏沉浸式，不显示 Tab
- 层级返回：单字临摹 ← 临摹页 ← 字帖库

### 5.1 App.jsx
- 初始化 IndexedDB，管理字帖列表与当前图片
- 视图路由（library / practice / settings）与 OCR 抽屉开关
- 图片上传校验、去重置顶、删除与清空
- 主题切换（跟随系统 / 浅色 / 深色）与轻提示

### 5.2 Library.jsx
- 2 列字帖卡片网格（缩略图 + 上传日期 + 大小）
- 空状态引导与「添加字帖」占位卡
- 卡片右上角菜单按钮触发删除确认

### 5.3 PracticeView.jsx
- 图片模式：Magnifier 悬停放大 + 点选单字
- 单字模式：SVG viewBox 裁剪、拖动平移、双指缩放、米字格辅助线
- 字符滑轨（前 2 / 当前 / 后 2）与底部工具栏（上一字 / 缩小 / 微调 / 放大 / 下一字）
- 微调方向盘、桌面端键盘快捷键

### 5.4 SegmentSheet.jsx
- 底部抽屉：在整幅图上叠加切分框，点任意框进入单字临摹
- 「自动 / 竖排 / 横排」分段切换，可重新切分
- 切不出字时引导手动点选

### 5.5 utils/charNav.js
- `getNextCharacterPosition` / `getPreviousCharacterPosition`：竖排按列推进
- `getCharacterNeighborhood`：生成滑轨的 5 个位置
- 从组件中提取为纯函数，与原实现做过 24000 次等价性对照

### 5.6 utils/segment.js
- `buildInkMask`: 缩放 + 灰度 + Otsu 二值化 + 反色修正，产出墨迹掩码
- `projectColumns` / `projectRows`: 垂直 / 水平墨迹投影
- `findBands`: 从投影中找出有墨连续段，合并字内间隙、过滤噪点
- `segmentCharacters`: 按列/行递归切分，超大块按中位字高等分，返回原图坐标的字框

## 6. 已知问题

1. react-image-magnifiers 存在 peer dependency 警告
2. 自动切分依赖背景干净、字距规整；透视严重或墨迹粘连的照片可能切不准，此时用手动点选
3. 版面（竖排/横排）自动判定对非规则网格可能出错，面板上可一键切换

## 7. 待完善功能

- 整幅作品自动切字（按竖排列切分）
- 临摹对比功能
- 导出/分享功能
