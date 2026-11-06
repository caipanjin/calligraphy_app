#!/usr/bin/env python3
"""生成切分回归夹具的墨迹 / 格线掩码（只读源图，不改项目代码）。

仅用于「再生成夹具」，不参与 npm test。依赖：Pillow、numpy。
复刻 src/utils/segment.js 的 buildInkMask（MAX_ANALYSIS_SIZE = 1600）：
  - 灰度 (R*299 + G*587 + B*114) / 1000 截断取整
  - 全局 Otsu 二值化；墨迹占比 > 0.6 时反色
  - faint：7x7 邻域（步长 3）灰度中位数减当前灰度 > 6，且当前不是墨迹
位压缩：每像素 1 bit，行优先、MSB first，与 test-segment-fixtures.mjs 的 unpack 对应。

注意：原始字帖图片不进仓库。其中七套来自本机 Downloads（含对联与三张黑底拓片），
需保证文件仍在；其余三套来自仓库内 docs/screens/ 的界面截图（按固定矩形裁剪）。
faint 的邻域中位数在距边缘 7px 内用 nanmedian 近似 JS 的「丢弃越界样本后
取上中位数」，格线均在图像内部，不影响检测结果。

用法：
  python3 scripts/gen-segment-fixtures.py
  python3 scripts/gen-segment-fixtures.py --name shi-vertical
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "fixtures" / "segment"
MAX_SIZE = 1600

FIXTURES = [
    {
        "name": "shi-vertical",
        "source": "~/Downloads/微信图片_2026-11-04_093111_421.jpg",
        "crop": None,
        "note": "无格竖排字帖 996x2203。修复目标图：「石」字顶部一横曾被切成独立框。",
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "yi-grid",
        "source": "~/Downloads/微信图片_2026-11-03_151331_930.jpg",
        "crop": None,
        "note": "方格楷书《马说》762x1280，含两个独立「一」。grid case 记录水平格线漏检一半的已知现状（一格含两字），修好该缺陷时会触发差异、需更新快照。",
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "real-photo",
        "source": "docs/screens/22-segment-real-photo.png",
        "crop": [85, 545, 670, 1275],
        "note": "真实拍照字帖的界面截图裁剪 585x730，含 UI 元素，用于抗干扰回归。",
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "dense-grid",
        "source": "docs/screens/23-segment-dense-grid.png",
        "crop": [38, 755, 745, 1500],
        "note": "密集格线字帖的界面截图裁剪 707x745，字距紧凑。",
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "full-screenshot",
        "source": "docs/screens/22-segment-real-photo.png",
        "crop": None,
        "note": "整张界面截图 780x1690，含标题栏、按钮、边框等大量非字帖干扰，用于退化检测与碎片过滤回归。",
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "couplet-vertical",
        "source": "~/Downloads/微信图片_2026-11-05_112243_931.jpg",
        "crop": None,
        "note": (
            "红底撒金对联 970x1910，左「天門日觀遙相開」右「岱宗之巔何壯哉」，每联 7 字，"
            "含左侧题款/印章。两列中心距 393px = 0.483W，曾因 estimatePitch 上限 0.4W "
            "被误拆成 6 列、切出 117 个小框；现由 needsWidePitchSearch 判定双联形态后"
            "放宽上限。当前快照为 15 框 / 2 联：右联 7 框准确，"
            "左联 8 框是已知缺陷——下半字间隙 9~12px < minGap 13px 被并成长带后按列宽均分，"
            "与字位错开。修复该缺陷时此快照会触发差异，需 --update。"
        ),
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "cursive-vertical",
        "source": "~/Downloads/IMG_4575.JPG",
        "crop": None,
        "note": (
            "无格行书 1080x880，4 列字数 5/4/4/4，各列字位与字高都不对齐："
            "同位字字心极差最大 157px（17.8% 图高），框高 115~239px，字间空白 -4~43px "
            "（含框重叠与连写穿插）。用于守住「不做跨列对齐 / 等距推断」的设计边界。"
            "free 记录当前自动切分现状 17 框；改动切分算法时会触发差异，需 --update。"
        ),
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "big-glyph-vertical",
        "source": "~/Downloads/微信图片_2026-11-06_222655_304.jpg",
        "crop": None,
        "note": (
            "黑底白字碑帖拓片「我則」531x1080，单列 2 个大字，右下角有公众号水印。"
            "修复目标图：列投影只有一条 420px 宽带，自相关把笔画宽 42px 当成字距，"
            "曾被拆成 10 列 / 132 个 42x45 小框。现由 isSingleWideColumn 依据"
            "「带宽/字高 0.91」判为单列大字特写，竖排 1 列 2 框。"
            "free 与 grid 两个 case 守住有格开关不改变结果（格线检测为 none）。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "big-glyph-edge-band",
        "source": "~/Downloads/微信图片_2026-11-06_225217_442.jpg",
        "crop": None,
        "note": (
            "黑底白字碑帖拓片 541x1082，单列 2 个大字，笔画几乎顶到左右边缘，右侧有浅色纸边。"
            "v5 修复目标图：列投影给出主带 [69,495] 宽 426 与贴边细带 [533,541] 仅 8px"
            "（墨迹只出现在上半幅，属拓片纸边不是笔画），pitch=43、score=0.468；"
            "旧判据要求恰好 1 条列带故不命中，主带被拆成 10 列、连同细带共 11 列 / 124 个小框。"
            "现由 isNegligibleEdgeBand 忽略贴边细带后判为单列大字，竖排 1 列 2 框。"
            "free 与 grid 两个 case 守住有格开关不改变结果（格线检测为 none）。"
            "已知缺陷：框 x=[67,497] 左右各裁 67/44px，框外墨迹约 5.4%（含纸边），"
            "长捺与左侧点被切，字框水平扩展受相邻空隙约束；修它会同时改变 "
            "big-glyph-vertical 快照，需有意更新。横排模式返回切分失败（两字本就上下排列），"
            "与 big-glyph-vertical 一致。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "big-glyph-narrow-gap",
        "source": "~/Downloads/微信图片_2026-11-06_230146_777.jpg",
        "crop": None,
        "note": (
            "黑底白字碑帖拓片「作我」527x1090，单列 2 个大字，笔画几乎顶到左右边缘，右下角有公众号水印。"
            "v6 修复目标图：列投影在 x229~237 出现 8px 局部低谷（该区域按 y 分桶仍有大量墨迹，并非列间空白），"
            "跌破 findBands 相对阈值且 8px > minGap 4px，把一条列带劈成 [59,229] / [237,474] 两条；"
            "isSingleWideColumn 看到 2 条实质列带不命中，pitch=211 / score=0.3，即使合并带宽 415 < 211x2.5 "
            "也会被保守条件挡住，旧结果为 2 列 7 框。现由 mergeNarrowGaps 合并 gap < 2%W 的相邻带，"
            "且只在发生合并时跳过 pitchx2.5 条件，竖排 1 列 2 框。"
            "free 与 grid 两个 case 守住有格开关不改变结果（格线检测为 none）。"
            "横排返回切分失败，与另两张大字拓片一致。"
            "已知缺陷：框 x=[57,476] 左右各裁 55/51px（首字）与 16/2px（次字），框外墨迹 2.2%/0.7%，"
            "「作」的长撇起笔略被切；字框水平扩展受相邻空隙约束，修它会同时改变另两张图的快照，需有意更新。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
]


def otsu(hist, total):
    sum_all = float(np.dot(np.arange(256), hist))
    w_b = 0.0
    sum_b = 0.0
    max_var = 0.0
    threshold = 128
    for i in range(256):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += i * hist[i]
        var = w_b * w_f * ((sum_b / w_b) - ((sum_all - sum_b) / w_f)) ** 2
        if var > max_var:
            max_var, threshold = var, i
    return threshold


def pack_bits(mask):
    flat = np.asarray(mask, dtype=np.uint8).ravel()
    pad = (-len(flat)) % 8
    if pad:
        flat = np.concatenate([flat, np.zeros(pad, dtype=np.uint8)])
    shifts = 7 - (np.arange(len(flat)) % 8)
    bits = (flat & 1).astype(np.uint8) << shifts
    return np.bitwise_or.reduce(bits.reshape(-1, 8), axis=1).astype(np.uint8).tobytes()


def build_masks(path, crop):
    im = Image.open(path).convert("RGB")
    if crop:
        im = im.crop(tuple(crop))
    nw, nh = im.size
    ratio = min(1, MAX_SIZE / max(nw, nh))
    W = max(1, round(nw * ratio))
    H = max(1, round(nh * ratio))
    arr = np.asarray(im.resize((W, H), Image.BILINEAR), dtype=np.uint8)
    rgb = arr.astype(np.float64)
    gray = ((rgb[:, :, 0] * 299 + rgb[:, :, 1] * 587 + rgb[:, :, 2] * 114) / 1000).astype(np.uint8).astype(np.int64)
    hist = np.bincount(gray.ravel(), minlength=256)
    th = otsu(hist, W * H)
    ink = (gray < th).astype(np.uint8)
    inverted = False
    if ink.mean() > 0.6:
        ink = 1 - ink
        inverted = True

    win = 7
    offs = list(range(-win, win + 1, 3))
    padded = np.full((H + 2 * win, W + 2 * win), np.nan)
    padded[win : win + H, win : win + W] = gray.astype(float)
    stack = np.stack(
        [padded[win + dy : win + dy + H, win + dx : win + dx + W] for dy in offs for dx in offs]
    )
    with np.errstate(all="ignore"):
        bg = np.nanmedian(stack, axis=0)
    bg = np.nan_to_num(bg, nan=255.0)
    faint = (((bg - gray) > 6) & (gray > th) & (ink == 0)).astype(np.uint8)

    return {
        "width": W,
        "height": H,
        "scale": W / nw,
        "imageWidth": nw,
        "imageHeight": nh,
        "threshold": int(th),
        "inkRatio": round(float(ink.mean()), 4),
        "faintRatio": round(float(faint.mean()), 4),
        "inverted": inverted,
        "ink": pack_bits(ink),
        "faint": pack_bits(faint),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", help="只生成指定夹具")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for fx in FIXTURES:
        if args.name and fx["name"] != args.name:
            continue
        path = Path(fx["source"]).expanduser()
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(f"跳过 {fx['name']}：源图不存在 {path}")
            continue
        m = build_masks(path, fx["crop"])
        (OUT / f"{fx['name']}.ink.bin").write_bytes(m.pop("ink"))
        (OUT / f"{fx['name']}.faint.bin").write_bytes(m.pop("faint"))
        doc = {
            "name": fx["name"],
            "source": fx["source"],
            "crop": fx["crop"],
            "note": fx["note"],
            **m,
            "inkFile": f"{fx['name']}.ink.bin",
            "faintFile": f"{fx['name']}.faint.bin",
            "cases": [
                {
                    "id": c["id"],
                    "options": {"layout": c["layout"], "hasGrid": c["hasGrid"]},
                    "expected": None,
                }
                for c in fx["cases"]
            ],
        }
        (OUT / f"{fx['name']}.json").write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"{fx['name']}: {m['width']}x{m['height']} scale={m['scale']:.4f} "
            f"otsu={m['threshold']} ink={m['inkRatio']} faint={m['faintRatio']} cases={len(doc['cases'])}"
        )


if __name__ == "__main__":
    main()
