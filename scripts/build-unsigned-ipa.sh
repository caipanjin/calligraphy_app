#!/usr/bin/env bash
#
# 一键构建「未签名 IPA」，供 AltStore / Sideloadly 用 Apple ID 签名后安装到 iPhone。
# 适用于 Xcode 图形界面打不开（提示需要升级）、无法走自动签名的情况：
# 本脚本只做纯编译（关闭代码签名），不需要登录 Apple ID，签名交给侧载工具完成。
#
# 用法：
#   bash scripts/build-unsigned-ipa.sh                 # Release，输出 build/书法临摹助手-unsigned.ipa
#   bash scripts/build-unsigned-ipa.sh Debug           # 指定配置
#   bash scripts/build-unsigned-ipa.sh Release my.ipa  # 指定输出文件名（相对项目根目录）
#
# 代码更新后重跑本脚本生成新 IPA，再在 AltStore 里「Install IPA」覆盖安装即可
# （bundle id 不变则原地更新、练习存档保留）。AltStore 的 Refresh 只续签名、不更新代码。
#
set -euo pipefail

# 切到项目根目录（脚本在 scripts/ 下）
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

CONFIG="${1:-Release}"
OUT_NAME="${2:-build/书法临摹助手-unsigned.ipa}"
DD="/tmp/calligraphy-unsigned"        # 独立 DerivedData，便于定位产物
STAGE="/tmp/calligraphy-ipa"          # IPA 打包暂存目录
PUBLIC="ios/App/App/public"

echo "==> 1/4 构建 web 资源 (npm run build)"
npm run build

echo "==> 2/4 同步 web 资源到 iOS public"
# 先清空再拷贝，避免残留旧的哈希命名资源。
# 不用 cap sync/copy：它们内部的删除在某些受管环境会被安全策略拦截。
rm -rf "$PUBLIC"
mkdir -p "$PUBLIC"
cp -R dist/. "$PUBLIC"/

echo "==> 3/4 xcodebuild 未签名编译 ($CONFIG)"
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration "$CONFIG" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DD" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

echo "==> 4/4 打包 IPA"
APP="$DD/Build/Products/${CONFIG}-iphoneos/App.app"
if [ ! -d "$APP" ]; then
  echo "错误：找不到编译产物 $APP" >&2
  exit 1
fi
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"

# 输出路径（相对项目根目录），确保父目录存在；先删旧文件避免 zip「替换原文件」报错
OUT_PATH="$ROOT/$OUT_NAME"
mkdir -p "$(dirname "$OUT_PATH")"
rm -f "$OUT_PATH"
( cd "$STAGE" && zip -qr "$OUT_PATH" Payload )

echo ""
echo "✅ 完成：$OUT_PATH"
echo "   大小：$(du -h "$OUT_PATH" | cut -f1)"
echo "   下一步：用 AltStore / Sideloadly 填入 Apple ID 签名并安装到 iPhone。"