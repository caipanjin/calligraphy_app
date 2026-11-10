#!/usr/bin/env bash
#
# 一键发布 IPA 到 GitHub Releases，并更新 AltStore Source JSON。
#
# 做的事（对应 AltStore 自动更新的四步）：
#   1. 构建未签名 IPA（调用 scripts/build-unsigned-ipa.sh）
#   2. 计算 size / sha256
#   3. 创建（或复用）GitHub Release，上传 IPA，得到直链
#   4. 在 altstore/source.json 的 versions 数组【最前面】插入新记录
#   5. 提交并推送 source.json，AltStore 下次刷新即可看到新版本
#
# 用法：
#   bash scripts/release-ipa.sh                  # 用 package.json 的 version，自动构建
#   bash scripts/release-ipa.sh 1.4.0            # 指定版本号
#   bash scripts/release-ipa.sh 1.4.0 --no-build # 跳过构建，复用已有 IPA
#   bash scripts/release-ipa.sh 1.4.0 --dry-run  # 只打印计划，不推送
#
# 前置条件：
#   - 已安装 gh 并登录（gh auth status 通过），或设置 GH_TOKEN 环境变量
#   - 仓库是 public（私有仓库的 Release 直链需要鉴权，AltStore 无法下载）
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# ---------- 参数 ----------
VERSION="${1:-}"
if [ "$VERSION" = "--no-build" ] || [ "$VERSION" = "--dry-run" ]; then
  VERSION=""
fi
[ -z "$VERSION" ] && VERSION="$(node -p "require('./package.json').version")"
shift || true

DO_BUILD=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

REPO="caipanjin/calligraphy_app"
TAG="v${VERSION}"
IPA_NAME="calligraphy-${VERSION}.ipa"
IPA_PATH="build/${IPA_NAME}"
SOURCE_JSON="altstore/source.json"

# gh 可能装在 ~/.local/bin
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
command -v gh >/dev/null || { echo "错误：找不到 gh CLI" >&2; exit 1; }

echo "==> 版本：$VERSION   标签：$TAG   仓库：$REPO"
echo ""

# ---------- 0. 前置检查：仓库必须 public ----------
VIS="$(gh repo view "$REPO" --json visibility -q .visibility 2>/dev/null || echo UNKNOWN)"
if [ "$VIS" != "PUBLIC" ]; then
  echo "⚠️  仓库可见性为 ${VIS}，私有仓库的 Release 直链需要鉴权，AltStore 无法下载。" >&2
  echo "    请先执行：gh repo edit $REPO --visibility public --accept-visibility-change-consequences" >&2
  [ "$DRY_RUN" = "1" ] || exit 1
fi

# ---------- 1. 构建 ----------
if [ "$DO_BUILD" = "1" ]; then
  echo "==> 1/5 构建未签名 IPA"
  bash scripts/build-unsigned-ipa.sh Release "$IPA_PATH"
else
  echo "==> 1/5 跳过构建（--no-build）"
  [ -f "$IPA_PATH" ] || { echo "错误：找不到 $IPA_PATH" >&2; exit 1; }
fi

# ---------- 2. 计算 size / sha256 ----------
SIZE="$(stat -f%z "$IPA_PATH" 2>/dev/null || stat -c%s "$IPA_PATH")"
SHA256="$(shasum -a 256 "$IPA_PATH" | awk '{print $1}')"
echo "==> 2/5 size=$SIZE  sha256=$SHA256"

# 从 IPA 里读真实版本号（以工程为准，避免 JSON 与包内不一致）
MIN_OS="$(unzip -p "$IPA_PATH" 'Payload/App.app/Info.plist' 2>/dev/null \
  | python3 -c "import sys,plistlib;d=plistlib.load(sys.stdin.buffer);print(d.get('MinimumOSVersion','13.0'))" 2>/dev/null || echo "13.0")"
BUILD_VER="$(unzip -p "$IPA_PATH" 'Payload/App.app/Info.plist' 2>/dev/null \
  | python3 -c "import sys,plistlib;d=plistlib.load(sys.stdin.buffer);print(d.get('CFBundleVersion','1'))" 2>/dev/null || echo "1")"
echo "    Info.plist: MinimumOSVersion=$MIN_OS  CFBundleVersion=$BUILD_VER"

# ---------- 3. 创建 Release 并上传 IPA ----------
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${IPA_NAME}"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> 3/5 [dry-run] 将创建 Release $TAG 并上传 $IPA_PATH"
  echo "==> 4/5 [dry-run] 将更新 $SOURCE_JSON"
  echo "==> 5/5 [dry-run] 将提交并推送 $SOURCE_JSON"
  echo ""
  echo "下载直链会是：$DOWNLOAD_URL"
  exit 0
fi

echo "==> 3/5 创建 Release $TAG 并上传 IPA"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "    Release 已存在，改为覆盖上传资产"
  gh release upload "$TAG" "$IPA_PATH" --repo "$REPO" --clobber
else
  gh release create "$TAG" "$IPA_PATH" \
    --repo "$REPO" \
    --title "书法临摹助手 ${VERSION}" \
    --notes "未签名 IPA，供 AltStore / Sideloadly 用 Apple ID 签名后安装。

- 版本：${VERSION}（build ${BUILD_VER}）
- 大小：${SIZE} 字节
- sha256：\`${SHA256}\`
- 最低系统：iOS ${MIN_OS}

AltStore 源地址：https://raw.githubusercontent.com/${REPO}/main/${SOURCE_JSON}"
fi

# ---------- 4. 更新 Source JSON ----------
echo "==> 4/5 更新 $SOURCE_JSON"
NOW="$(python3 -c "from datetime import datetime;print(datetime.now().astimezone().isoformat(timespec='seconds'))")"

python3 - "$SOURCE_JSON" "$VERSION" "$NOW" "$DOWNLOAD_URL" "$SIZE" "$SHA256" "$MIN_OS" <<'PY'
import json, sys

path, version, now, url, size, sha, min_os = sys.argv[1:8]
size = int(size)

with open(path, encoding='utf-8') as f:
    src = json.load(f)

app = src['apps'][0]
entry = {
    "version": version,
    "date": now,
    "localizedDescription": f"书法临摹助手 {version}",
    "downloadURL": url,
    "size": size,
    "sha256": sha,
    "minOSVersion": min_os,
}

# 最前面插入新版本；同版本号则替换，避免重复
versions = app.get('versions', [])
versions = [v for v in versions if v.get('version') != version]
versions.insert(0, entry)
app['versions'] = versions

# 顶层便捷字段同步为最新版（AltStore 用它显示当前版本）
app['version'] = version
app['versionDate'] = now
app['versionDescription'] = entry['localizedDescription']
app['downloadURL'] = url
app['size'] = size
app['minOSVersion'] = min_os

with open(path, 'w', encoding='utf-8') as f:
    json.dump(src, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f"    versions 现有 {len(versions)} 条，最新 {versions[0]['version']}")
PY

# ---------- 5. 提交并推送 ----------
echo "==> 5/5 提交并推送 Source JSON"
GIT="/Applications/Xcode.app/Contents/Developer/usr/bin/git"
command -v "$GIT" >/dev/null 2>&1 || GIT="git"

"$GIT" add "$SOURCE_JSON" altstore/icon-512.png 2>/dev/null || "$GIT" add "$SOURCE_JSON"
if "$GIT" diff --cached --quiet; then
  echo "    Source JSON 无变化，跳过提交"
else
  "$GIT" commit -m "chore(altstore): 发布 ${VERSION}，更新 Source JSON"
  "$GIT" push origin HEAD
fi

echo ""
echo "✅ 发布完成"
echo "   Release：https://github.com/${REPO}/releases/tag/${TAG}"
echo "   IPA    ：${DOWNLOAD_URL}"
echo "   源地址 ：https://raw.githubusercontent.com/${REPO}/main/${SOURCE_JSON}"
echo ""
echo "   手机 AltStore → Sources → 添加上述源地址，即可收到 ${VERSION} 更新。"
