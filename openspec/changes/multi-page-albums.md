# 多页字帖 + 按字帖释放内存

## 1. 背景与动机

真机 iOS 报 `Terminated due to memory issue`（jetsam）。排查发现根因不只是「临时位图没释放」，
更是数据结构本身：`images` store 以 `recent_0..19` 存 20 张完整 base64，
App 启动时 `getAll()` 一次性全部读进 React state 并常驻到进程结束；
`PracticeView` 底部那条「最近字帖」还把 20 张原图直接挂到 `<img src>`。

本轮换思路：与其继续在解码层做微优化，不如把「字帖」升级成真正的实体
（一本字帖 = 多张页图），并让「关闭字帖」成为明确的内存边界。

## 2. 已确认的四项决策

| 决策点 | 选择 |
|---|---|
| 旧数据（最多 20 张单图） | **清空重建**，不迁移；v4→v5 时删除 `images` store 并清空遗留缓存，App 提示重新导入 |
| 建帖方式 | **一次多选自动建一本字帖**，支持之后继续加页、删单页、重命名、删整本 |
| 跨字帖同图 | **按图片内容共享**切分 / 练习记录（沿用 `hashImageData`）；「无关联」只体现在列表与内存生命周期 |
| 上一轮 P0 修复 | 先作为独立提交 `041c417` 入库并 push，给重构留干净基线 |

## 3. 数据模型（IndexedDB v4 → v5）

```
albums  { id, title, createdAt, updatedAt, coverThumb, pages: [{id, hash, size, addedAt}] }
pages   { id, albumId, dataUrl }          ← 唯一持有完整 base64
thumbs  { id: pageId, thumb }             ← 240px 小图，分页条进入可视区才单条读
meta    { id: 'current', albumId, pageId }
segmentations / segmentationSettings / practiceRecords / practiceDaily   ← 键不变
```

**硬约束**：任何读取「字帖列表」的路径都不得加载 `pages` store。
`readAlbums()` 只返回元数据；`readPage(pageId)` 是唯一拿到完整原图的入口，
且只在打开 / 切换某一页时调用一次。切页时 `<PracticeView key={activePageId}>` 强制重挂载，
旧页的解码位图、切分框、续练 ref、计时器随之卸载。

进度汇总改为 `segmentations` / `practiceRecords` 各 `getAll()` 一次，在内存里按页哈希组装
（`albumProgress.js`），避免多页字帖下几千次 IndexedDB 往返，也完全不需要读原图。

## 4. 内存生命周期

- 字帖库：只持有元数据与每本一张封面小图，无任何完整 base64。
- 打开字帖：内存里最多 1 份当前页原图；分页条只渲染 240px 缩略图，
  `LazyPageThumb` 用 `IntersectionObserver`（160px 预取）按需读 `thumbs`。
- 返回字帖库：`setImage(null)` + `setSelectedCharacter(null)` + `setShowSegment(false)`
  + `clearThumbnailCache()` + 清空 activeAlbumId / activePageId，并取消未完成的切页读取。
  磁盘数据与 `meta.current` 保留，重开自动回到上次那一页。
- 缩略图模块缓存改用 `hashImageData(dataUrl)` 作 key，不再强引用整串 base64；
  `buildThumbnail` 在生成失败时不外泄原图（旧实现会回退成完整 dataUrl）。

## 5. 明确不做（沿用既有红线）

- 不做 OCR、不做拍照评分、不做云同步 / 账号、不做「已掌握」。
- 不做跨字帖对齐、等距推断、字位模板映射 —— 无格行书各列字数与字距都不齐。
- 不改 `segmentFromMasks` 任何切分计算；`SEGMENT_ALGORITHM_VERSION` 仍为 **3**，
  7 套 golden 快照逐字节不变。
- 删单页 / 删整本不级联删除按哈希寻址的缓存（同图可能在别的字帖），
  孤儿记录由「清空全部字帖」统一回收。

## 6. 验证

- `npm test` **205 项**通过（新增 `test-album-store.mjs` 27 项：建帖/加页/删页/删帖/改名/
  续练指针/v5 升级、进度汇总、以及「关闭即释放」「列表不读原图」的静态断言）。
- `npm run build` 通过、`git diff --check` 干净。
- 真实 Chrome + 真实 IndexedDB 的 CDP 冒烟测试 **24 项全过**：构造 v4 旧库 →
  App 升级 v5（旧 store 删除、遗留缓存清空、新表齐备、升级提示可见）→
  写入 2 页字帖 → 卡片渲染标题/页数/续练标记/小封面 → 点开字帖渲染分页条 →
  返回后原图节点与分页条均已卸载、数据仍可从磁盘恢复；除 `favicon.ico` 404 外无 JS 异常。

## 7. 已知限制

- 导入时 N 张图的 dataUrl 仍会短暂同时驻留（文件读取不可避免），已用串行生成缩略图
  限制额外解码峰值；真机峰值仍需 Instruments 实测。
- 打开切分面板时 `PracticeView` 与 `SegmentSheet` 仍各持一份当前页 `<img>`，
  4000px 级超大图依旧可能是瓶颈。
- 指针捕获与触屏手柄命中区尚未做真机点按验证，需 `npm run ios:copy` 后实测。
