# AltStore 自动更新接入说明

本目录是 AltStore 源的发布根目录，由 **GitHub Pages** 直接托管
（`https://caipanjin.github.io/calligraphy_app/`）。
配合 GitHub Releases，实现「电脑发布 IPA → 手机 AltStore 自动检测升级」。

## 为什么用 GitHub Pages 而不是 Release 直链

国内网络直连 `github.com` 会超时（实测 20 秒无响应），而 `caipanjin.github.io`
约 0.6 秒可通。所以：

- **下载直链走 Pages**：`https://caipanjin.github.io/calligraphy_app/altstore/ipa/calligraphy-X.Y.Z.ipa`
- **Release 仍然创建**，作为归档、changelog 和海外加速备份

## 文件

| 文件 | 作用 |
|---|---|
| `altstore/source.json` | AltStore 源清单。`apps[0].versions` 数组**第一项**即最新版，AltStore 据此判断是否有更新 |
| `altstore/icon-512.png` | 源内显示的应用图标（512×512） |
| `altstore/ipa/*.ipa` | 各版本 IPA，由 Pages 托管为下载直链（`.gitignore` 里加了例外，否则被 `*.ipa` 忽略） |
| `scripts/release-ipa.sh` | 本地一键发布：构建 IPA → 传 Release → 拷到 `altstore/ipa/` → 改 JSON → 推送 |
| `.github/workflows/release-ipa.yml` | 打 tag 后由 CI 全自动完成上述流程 |

## 源地址

```
https://caipanjin.github.io/calligraphy_app/altstore/source.json
```

备用（海外 / 直连 GitHub 正常时）：

```
https://raw.githubusercontent.com/caipanjin/calligraphy_app/main/altstore/source.json
```

## 一次性准备

1. **仓库必须公开**。私有仓库的 Pages 与 Release 都需要鉴权，AltStore 无法下载。
   检查：`gh repo view caipanjin/calligraphy_app --json visibility`
   改公开：`gh repo edit caipanjin/calligraphy_app --visibility public --accept-visibility-change-consequences`

2. **开启 GitHub Pages**，源选 `main` 分支根目录 `/`：
   ```bash
   gh api -X POST repos/caipanjin/calligraphy_app/pages \
     -f 'source[branch]=main' -f 'source[path]=/'
   ```

3. **登录 gh CLI**（本地发布需要）：`gh auth login`

## 日常发版

### 方式 A：本地一条命令

```bash
# 1. 改版本号（三处必须一致）
#    package.json                    version
#    ios/App/App.xcodeproj/project.pbxproj  MARKETING_VERSION（2 处）、CURRENT_PROJECT_VERSION（2 处，每次 +1）
#    android/app/build.gradle        versionName / versionCode

# 2. 发布
bash scripts/release-ipa.sh 1.4.0
```

脚本会：构建未签名 IPA → 算 size/sha256 → 建 Release `v1.4.0` 并上传 `calligraphy-1.4.0.ipa`
→ 复制到 `altstore/ipa/` → 在 `versions` 最前面插入新记录 → 提交并推送。

```bash
bash scripts/release-ipa.sh 1.4.0 --dry-run   # 只打印计划
bash scripts/release-ipa.sh 1.4.0 --no-build  # 复用已有 IPA
```

### 方式 B：打 tag 交给 CI

```bash
git tag v1.4.0 && git push origin v1.4.0
```

GitHub Actions（macOS runner，自带 Xcode）会自动编译、发 Release、把 IPA 放进
`altstore/ipa/`、回写 `source.json` 到 main，Pages 随后自动重新部署。

也可以手动触发：

```bash
gh workflow run release-ipa.yml -f version=1.4.0
```

## 在手机上添加源

AltStore → **Sources** → 右上角 `+` → 粘贴上面的 Pages 源地址。

添加后进入「书法临摹助手」，即可看到版本列表并安装。之后每次发版，AltStore 刷新源会自动提示更新。

## 关键约束

- **`version` 必须单调递增**，否则 AltStore 不会认为是更新。脚本用 `package.json` 的版本号，CI 用 tag 名。
- **`sha256` 必须与实际上传的 IPA 一致**，AltStore 会校验，不一致会拒绝安装。脚本自动计算。
- **`date` 是 ISO8601 带时区偏移**（如 `2026-11-10T09:15:23+08:00`），不是纯日期。
- **IPA 是未签名的**。AltStore 会用你的 Apple ID 重新签名后安装；bundle id 不变即可原地覆盖升级，练习存档保留。
- AltStore 的「Refresh」只续签名，不更新代码；更新代码要靠源的版本号变化。
- **`ios/App/Pods` 不在库里**（`ios/.gitignore` 第 2 行）。CI 检出后必须先 `cd ios/App && pod install`，
  否则 xcodebuild 报 `Unable to open base configuration reference file '.../Pods-App.release.xcconfig'`。

## 手工改 JSON 时

`versions` 数组第一项即最新版，必须包含：

```json
{
  "version": "1.4.0",
  "date": "2026-11-10T09:15:23+08:00",
  "localizedDescription": "书法临摹助手 1.4.0",
  "downloadURL": "https://caipanjin.github.io/calligraphy_app/altstore/ipa/calligraphy-1.4.0.ipa",
  "size": 4367374,
  "sha256": "980061b4...",
  "minOSVersion": "13.0"
}
```

同时把顶层 `apps[0]` 的 `version` / `versionDate` / `versionDescription` / `downloadURL` / `size`
同步为最新版，AltStore 用它显示「当前版本」。
