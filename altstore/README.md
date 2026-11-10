# AltStore 自动更新接入说明

本目录存放 AltStore Source JSON 与应用图标。配合 GitHub Releases，实现「电脑发布 IPA → 手机 AltStore 自动检测升级」。

## 文件

| 文件 | 作用 |
|---|---|
| `altstore/source.json` | AltStore 源清单。`apps[0].versions` 数组**第一项**即最新版，AltStore 据此判断是否有更新 |
| `altstore/icon-512.png` | 源内显示的应用图标（512×512） |
| `scripts/release-ipa.sh` | 本地一键发布：构建 IPA → 传 Release → 改 JSON → 推送 |
| `.github/workflows/release-ipa.yml` | 打 tag 后由 CI 全自动完成上述流程 |

## 一次性准备

1. **仓库必须公开**。私有仓库的 Release 直链需要鉴权，AltStore 无法下载。
   检查：`gh repo view caipanjin/calligraphy_app --json visibility`
   改公开：`gh repo edit caipanjin/calligraphy_app --visibility public --accept-visibility-change-consequences`

2. **登录 gh CLI**（本地发布需要）：`gh auth login`

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

脚本会：构建未签名 IPA → 算 size/sha256 → 建 Release `v1.4.0` 并上传 `calligraphy-1.4.0.ipa` → 在 `versions` 最前面插入新记录 → 提交并推送 `source.json`。

```bash
bash scripts/release-ipa.sh 1.4.0 --dry-run   # 只打印计划
bash scripts/release-ipa.sh 1.4.0 --no-build  # 复用已有 IPA
```

### 方式 B：打 tag 交给 CI

```bash
git tag v1.4.0 && git push origin v1.4.0
```

GitHub Actions（macOS runner，自带 Xcode）会自动编译、发 Release、回写 `source.json` 到 main。

## 在手机上添加源

AltStore → **Sources** → 右上角 `+` → 粘贴：

```
https://raw.githubusercontent.com/caipanjin/calligraphy_app/main/altstore/source.json
```

添加后进入「书法临摹助手」，即可看到版本列表并安装。之后每次发版，AltStore 刷新源会自动提示更新。

## 关键约束

- **`version` 必须单调递增**，否则 AltStore 不会认为是更新。脚本用 `package.json` 的版本号，CI 用 tag 名。
- **`sha256` 必须与实际上传的 IPA 一致**，AltStore 会校验，不一致会拒绝安装。脚本自动计算。
- **`date` 是 ISO8601 带时区偏移**（如 `2026-11-10T09:15:23+08:00`），不是纯日期。
- **IPA 是未签名的**。AltStore 会用你的 Apple ID 重新签名后安装；bundle id 不变即可原地覆盖升级，练习存档保留。
- AltStore 的「Refresh」只续签名，不更新代码；更新代码要靠源的版本号变化。

## 手工改 JSON 时

`versions` 数组第一项即最新版，必须包含：

```json
{
  "version": "1.4.0",
  "date": "2026-11-10T09:15:23+08:00",
  "localizedDescription": "书法临摹助手 1.4.0",
  "downloadURL": "https://github.com/caipanjin/calligraphy_app/releases/download/v1.4.0/calligraphy-1.4.0.ipa",
  "size": 4367374,
  "sha256": "980061b4...",
  "minOSVersion": "13.0"
}
```

同时把顶层 `apps[0]` 的 `version` / `versionDate` / `versionDescription` / `downloadURL` / `size` 同步为最新版，AltStore 用它显示「当前版本」。
