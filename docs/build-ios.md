# iOS 构建与同步

## 为什么「改了代码，手机上没变」

Capacitor 的 iOS 工程不读 `dist/`，它打包的是 **`ios/App/App/public/`** 里的静态副本。

```
npm run build  →  dist/            （Vite 产物）
                      ↓  必须手动同步
                 ios/App/App/public/  ← Xcode 真正打进 .app 的内容
```

跳过同步这一步，Xcode 会把**上一次同步的旧版本**装到手机上。本项目就踩过这个坑：
`ios/App/App/public/index.html` 停留在 2025-01-24，而 `dist` 已经是最新版本。

## 正确流程

```bash
# 每次改完前端代码
npm run ios:copy     # 构建 + 拷贝 web 资源（快，日常够用）
# 或
npm run ios:sync     # 构建 + 拷贝 + pod install（改过插件/依赖时用）

# 打开 Xcode 运行
npm run ios:open
```

一条命令搞定「构建 → 同步 → 打开 Xcode」。

## 命令说明

| 命令 | 作用 | 何时用 |
|---|---|---|
| `npm run ios:copy` | `vite build` + 拷贝 `dist` 到 iOS | 只改了 JS/CSS/图片 |
| `npm run ios:sync` | 上面 + `pod install`、更新插件 | 装了/升级了 Capacitor 插件 |
| `npm run ios:open` | 上面 + 打开 Xcode | 准备真机调试 |
| `npm run android:copy` / `:sync` / `:open` | Android 对应命令 | — |

> `npm run build` 会自动执行 `prebuild`，先把 OCR 离线资源（约 12MB）准备好，
> 所以 `dist/tesseract/` 和 `ios/App/App/public/tesseract/` 都会带上，离线识别才能用。

## 判断是否同步成功

```bash
grep -o 'index-[a-z0-9]*\.js' ios/App/App/public/index.html
grep -o 'index-[a-z0-9]*\.js' dist/index.html
```

两个指纹一致即已同步。文件名带内容哈希，**指纹不同就说明手机上跑的是旧包**。

## 仍然没更新时的排查顺序

1. **Xcode 里 Clean Build Folder**：`⇧⌘K`，然后重新 Run
2. **删掉手机上的旧 App** 再装（排除启动图/缓存假象）
3. **确认 Xcode 打开的是 `ios/App/App.xcodeproj`**，不是根目录
4. 确认设备上装的是同一个 Bundle ID：`com.caipanjin.calligraphy`
5. 检查 `ios/App/App/public` 时间戳是否为你刚才同步的时间

## 环境问题记录

- **`npm install` 报 `~/.npm` 权限错误**：本机 `~/.npm` 属主曾变成 root。
  临时绕过：`npm install --cache /tmp/npm-cache`；
  彻底修复：`sudo chown -R $(id -u):$(id -g) ~/.npm`
- **`npx cap` 报 `Cannot find module '../dist/index'`**：`node_modules` 里的
  `@capacitor/cli`、`@capacitor/core`、`@ionic/*` 等包残缺（缺 `dist/`）。
  修复：`npm ci --legacy-peer-deps`（`--legacy-peer-deps` 是因为
  `react-image-magnifiers` 声明了 `react@^16` 的 peer 依赖，与 React 18 冲突）
