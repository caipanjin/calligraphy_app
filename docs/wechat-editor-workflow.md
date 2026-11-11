# 公众号正文更新（固定通道）

> 改完定稿 md 后，跑一条命令，已打开的公众号图文编辑器里的正文就整篇换成新版：标题 / 摘要 / 封面不动，排版（小标题、列表、代码块、加粗）不丢。
>
> **不要再重新推理 CDP 端口、剪贴板、粘贴事件这些细节**，工具已把验证过的路径固化。

## 什么时候用

- 公众号文章改写 / 重写后，要把新版推进**已经打开**的图文编辑页
- 不想手工「全选 → 复制渲染后的富文本 → 粘贴」

**不适用**：从零新建草稿。那是 `~/.workbuddy/skills/baoyu-post-to-wechat/` 发布脚本的职责（该脚本目前卡在公众号 `#title` 控件的 CDP 校验上，只能把正文送进编辑器，标题 / 摘要 / 封面仍需人工补）。本工具只管「已有窗口的正文替换」。

## 前置条件

1. 发布专用 Chrome（profile 含 `baoyu-skills/chrome-profile`）已登录公众号后台，且打开着图文编辑页（URL 含 `appmsg_edit`）
2. Node >= 22（需要全局 `fetch` / `WebSocket`）
3. `bun` 可用（用于渲染 Markdown）；若已有渲染好的 HTML，用 `--html` 跳过
4. `baoyu-post-to-wechat` skill 位于 `~/.workbuddy/skills/`

## 一条命令

```bash
cd /Users/caipanjin/study/calligraphy_app

# 正式替换
node scripts/update-wechat-body.mjs docs/wechat-article-title1-final.md

# 只生成 HTML 看统计，不连浏览器、不改编辑器
node scripts/update-wechat-body.mjs docs/wechat-article-title1-final.md --dry-run

# 只读检查编辑器当前状态
node scripts/update-wechat-body.mjs --check-only
```

输出 `OK` 且退出码 0 即完成。工具会打印替换前后的字数、块结构数、代码块数和当前标题。

## 参数

| 参数 | 说明 |
|---|---|
| `<markdown.md>` | 位置参数，必填（`--check-only` 或 `--html` 时除外） |
| `--html <path>` | 使用已渲染好的公众号 HTML，跳过 Markdown 转换 |
| `--theme <name>` | 渲染主题，默认 `default` |
| `--converter <path>` | 覆盖 `md-to-wechat.ts` 路径 |
| `--port <n>` | 指定 Chrome 调试端口（默认自动从进程命令行探测） |
| `--dry-run` | 只生成 HTML 并统计，不连浏览器 |
| `--check-only` | 只读编辑器状态，不修改任何内容 |
| `--json` | 输出单个 JSON 对象，便于脚本串联 |

## 工具内部做了什么

1. **渲染**：以子进程调用 `md-to-wechat.ts`（`--theme default`），拿到 `temp-article.html`
2. **取片段**：抽出 `<div id="output">` 内的正文，顺带算纯文本首句作为校验基准
3. **定位浏览器**：从 Chrome 进程命令行匹配 `--remote-debugging-port`，再用 `/json/list` 找 `appmsg_edit` 页；找不到会明确报错并提示 `--port`
4. **保护**：把替换前正文备份到系统临时目录；两次真实点击 + `focus()`，并**校验 `activeElement` 在正文编辑器内**，否则直接中止（防止 Cmd+A 误删标题 / 摘要）
5. **替换**：`Cmd+A` + `Backspace` 清空 → 派发 `ClipboardEvent('paste')`，`DataTransfer` 带 `text/html` + `text/plain`
6. **校验**：最多轮询 12 秒，检查首句命中、块结构数 ≥ 5、字数达标；失败自动用 `insertHTML` 兜底恢复文字

工具**不改标题、摘要、封面，也不点保存草稿**；每次运行都会打印旧正文备份路径。

## 已验证的坑（别再重走）

| 做法 | 结果 |
|---|---|
| `document.execCommand('insertHTML')` 直接插 | 文字全在，但整篇被压成 **1 个 section / 1 个 span**，小标题、列表、代码块、换行全丢。发布脚本自带路径就是这样 |
| CDP `Input.dispatchKeyEvent` 合成 `Cmd+V` | 不会读系统剪贴板，粘完编辑器仍是空 |
| 系统剪贴板写 `public.html` | Swift 通道要求同意 Xcode license（`exit 69`）；JXA 可写，但**无参 ObjC 方法不加括号**（`pb.clearContents;` 而非 `pb.clearContents()`），且合成按键仍然不生效 |
| 直接 `import md-to-wechat.ts` | 该文件顶层带 CLI 入口，import 会先打印 usage 并退出，必须走子进程 |
| 重跑发布脚本 `wechat-article.ts` | `#title` 是 TEXTAREA，CDP 输入后校验读到空值 → `Title was modified during paste` 中止；残留 Chrome 还会占用调试端口报 502 |
| 不校验焦点就 `Cmd+A` | 焦点若落在标题 / 摘要框，会误删用户已填内容 |

**结论**：页面内派发带 `text/html` 的 paste 事件是唯一稳定保住排版的方式；系统剪贴板整条路都不需要。

## 校验与失败处理

| 状态 | 退出码 | 含义 / 处理 |
|---|---|---|
| `OK` | 0 | 首句、块结构、字数全部通过 |
| `FALLBACK_FLAT` | 2 | 富文本粘贴未通过，已用 `insertHTML` 恢复文字，但排版被压平；在编辑器里手动重新粘贴一次 |
| `FAILED` / `ERROR` | 1 | 替换失败或前置条件不满足；旧正文已备份，路径打印在输出里，可重跑或用备份恢复 |

`--json` 会输出包含 `before` / `after` / `backup` / 校验项的结构化结果。

## 手动收尾（工具不代劳）

1. **摘要**：改稿后要同步更新，工具不会动它（公众号摘要上限 120 字）
2. **封面**：上传 900×383 图
3. **保存草稿**：工具不会替你点保存，避免把未填完的状态定下来

## 相关文件

| 文件 | 用途 |
|---|---|
| `scripts/update-wechat-body.mjs` | 本工具 |
| `docs/wechat-article-title1-final.md` | 当前发布定稿（标题 1） |
| `docs/wechat-article-ios-free-dev.md` | 原始创作稿（候选标题、合规自查、3 套封面方案） |
| `docs/covers/wechat-title1-cover.png` | 900×383 封面（方案 A） |
| `~/.workbuddy/skills/baoyu-post-to-wechat/` | 从零新建草稿的发布工具 |
