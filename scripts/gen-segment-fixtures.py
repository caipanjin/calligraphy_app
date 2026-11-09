#!/usr/bin/env python3
"""生成切分回归夹具的墨迹 / 格线掩码（只读源图，不改项目代码）。

仅用于「再生成夹具」，不参与 npm test。依赖：Pillow、numpy。
复刻 src/utils/segment.js 的 buildInkMask（MAX_ANALYSIS_SIZE = 1600）：
  - 灰度 (R*299 + G*587 + B*114) / 1000 截断取整
  - 全局 Otsu 二值化；墨迹占比 > 0.6 时反色
  - faint：7x7 邻域（步长 3）灰度中位数减当前灰度 > 6，且当前不是墨迹
位压缩：每像素 1 bit，行优先、MSB first，与 test-segment-fixtures.mjs 的 unpack 对应。

注意：原始字帖图片不进仓库。其中十一套来自本机 Downloads（含对联、五张黑底拓片、
一张浅褐行草条幅与一张白底装裱对联），需保证文件仍在；其余三套来自仓库内 docs/screens/ 的
界面截图（按固定矩形裁剪）。
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
            "放宽上限。左联下半字间空白仅 3~10 行 < gapRow 13px，旧版 findBands 把 5 个字"
            "并成 818px 超长带后按列宽五等分、切点穿字（15 框，左联 8 框错位）。"
            "v12 的 rebandLongGlyphBand 对该带按本列行投影重切，切点吸附到真实字间空白；"
            "当前快照 14 框 / 2 联，左右各 7 框逐字准确。改动切分算法时会触发差异，需 --update。"
        ),
        "cases": [{"id": "free", "layout": "vertical", "hasGrid": False}],
    },
    {
        "name": "couplet-inscription",
        "source": "~/Downloads/IMG_4596.JPG",
        "crop": None,
        "note": (
            "橙底楷书对联 1080x2238，左「百寶一氣垂丹淵」右「層檐直上見華蓋」，"
            "每联 7 字，另有左右题款小字与中缝；列投影检出 5 条列带"
            "（题款 16 / 左联 143 / 中缝 48 / 右联 144 / 题款 32）。"
            "旧版 sortByReadingOrder 的分列步长取列带中位数 48（原图约 67），"
            "同列内 x 偏移 ≥17px 即被误判成换列，排序退化成按 x 降序："
            "左联尾部「垂丹淵」在数组中倒序成「淵丹垂」，框位置全对，"
            "但「下一字」会从「氣」跳到「淵」。v13 改用框宽中位数（约 220px）作步长，"
            "快照 14 框、左右各 7 框且严格按阅读顺序。"
            "本夹具专门守住框数组顺序：坐标或顺序任一变化都会触发差异。"
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
            "v10 已修复裁笔画：水平扩展改用列间空隙左右独立限额，框由 x=[67,497] 扩到 "
            "[25,528]，长捺与左侧点完整入框；剩约 4% 框外墨迹是 x=0 的拓片纸边而非笔画。"
            "横排模式返回切分失败（两字本就上下排列），与 big-glyph-vertical 一致。"
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
            "v10 已修复裁笔画：水平扩展改用列间空隙左右独立限额，「作」的长撇起笔完整入框，框外墨迹清零。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "big-glyph-width-cap",
        "source": "~/Downloads/微信图片_2026-11-06_234549_235.jpg",
        "crop": None,
        "note": (
            "黑底白字碑帖拓片「凡厥」550x1082，单列 2 个大字，笔画顶满左右边缘，右下角有公众号水印。"
            "v7 修复目标图：反色正常（暗 73.36% → 墨迹 26.64%，Otsu 117），列带只有一条 [47,516] 宽 469、"
            "行带 [57,466]/[596,1015]，pitch=44 / score=0.354，isSingleWideColumn 已命中、字距视为 0；"
            "算法本已算出两个正确框 x=[45,518] 宽 473，但 MAX_SIZE_RATIO=0.85 给出 maxW=467.5，"
            "两个框都被当成「整页被当成一个字」的异常块删光，返回 failed/empty（0 框）。"
            "前三张大字拓片列带宽占比都 <0.79，本图 469/550=0.8527 只越线 5.5px。"
            "现由 maxBoxWidthRatio 仅在命中单列大字时把宽度上限放宽（v7 为 0.95W，v10 再放宽到整幅），竖排 1 列 2 框。"
            "free 与 grid 两个 case 守住有格开关不改变结果（格线检测为 none）。"
            "横排返回切分失败，与另三张大字拓片一致。"
            "v10 已修复裁笔画：水平扩展改用列间空隙左右独立限额，「厥」左侧长撇下端与右下捺尖完整入框，框外墨迹清零。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "big-glyph-stroke-pitch",
        "source": "~/Downloads/微信图片_2026-11-06_234703_984.jpg",
        "crop": None,
        "note": (
            "黑底白字碑帖拓片「翁同龢書」523x1068，右侧单列 4 个大字，左侧两枚方形印章，"
            "右下角有公众号水印。v8 修复目标图：这是首个多列版式（不只是单列 2 字），"
            "反色正常（暗 91.51% → 墨迹 8.49%，Otsu 107），列投影给出两条真实列带 "
            "[79,210]（印章列，宽 131）、[327,463]（正文列，宽 136），行带 "
            "[171,344]/[388,527]/[543,980]，格线检测 none。"
            "needsWidePitchSearch 把「两条窄带、列心距 0.479W」误判成双联并放宽搜索上限，"
            "estimatePitch 锁到 pitch=42 / score=0.397，其实只是笔画宽（列宽的 1/3）；"
            "isSingleWideColumn 要求剔除细带后恰好 1 条实质列带，这里有 2 条故不命中，"
            "splitBandsByPitch 把两条带各拆 3 列，再按 42px 行高切成 6 列 / 53 个 47x46 小框，"
            "横排更退化成 84 个 grid 小格。"
            "现由 isStrokeLevelPitch 先剔除 <5%W 的细伪带，要求剩余 >=2 条实质列带且 "
            "pitch < 0.6x 最窄实质列带宽时把字距视为 0（列间距不可能比任何真实列带还窄）；"
            "只有一条宽列带时必须放行，否则会破坏 dense-grid 与 full-screenshot 的拆列。"
            "竖排 2 列 6 框：正文 4 字 + 印章 2 枚。free 与 grid 两个 case 守住有格开关不改变结果。"
            "横排返回切分失败，与另四张大字拓片一致。"
            "已知缺陷：印章被当成 2 个「字」输出（若要只留 4 个单字需另做印章列识别）。"
            "v10 已修复裁笔画：「龢」右侧长捺、「同」左侧探出笔画完整入框，框外墨迹清零。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "cursive-tall-glyph",
        "source": "~/Downloads/微信图片_2026-11-07_084710_718.jpg",
        "crop": None,
        "note": (
            "浅褐色无格行草条幅 639x2465（分析图 415x1600），4 列，修复后切出 56 框，含左侧题款与印章。"
            "v9 修复目标图：行草单字明显高于列宽，splitTallGlyphs 旧逻辑按列宽机械二等分/三等分，"
            "切分线直接穿过笔画，把 5 组单字各切成了两框（#10/11、#12/13、#43/44、"
            "#50/51、#58/59），这些框垂直重叠 5~6px 且交界处墨迹连续；真正的字间空白"
            "在 y642-650、y1144-1153 等处，离等分切点几十像素。"
            "现由 blankGuidedCuts 让等分只决定「切几刀」，切点本来就空就保留、穿过笔画"
            "则吸附到附近最长空白段、找不到空白就撤销这一刀；护栏限定只对短（≤3.2 倍列宽）、"
            "稀疏（带内墨迹 ≤35%）、二/三等分的带生效，格线字帖长带与实心块仍按原逻辑等分"
            "（不加护栏会把红底对联 5 个字并成 746px 巨框）。竖排 4 列由 60 框变 56 框，"
            "中列 #16/17 这组本来正确的两框保持不变。free 与 grid 两个 case 守住"
            "有格开关不改变结果（格线检测为 none）。已知瑕疵：#42 污渍框、#18 扁框、"
            "#60 印章框仍需编辑态手动删除。"
        ),
        "cases": [
            {"id": "free", "layout": "vertical", "hasGrid": False},
            {"id": "grid", "layout": "vertical", "hasGrid": True},
        ],
    },
    {
        "name": "mounted-couplet",
        "source": "~/Downloads/c668b02cafe40c25ad882d6f5eeacba2.JPG",
        "crop": None,
        "note": (
            "白底黑字装裱对联 1968x3840（分析图 820x1600），楷书偏行：右联「仁者不憂智者不惑勇者不懼」"
            "12 字、左联「視其所以觀其所由察其所安」12 字，左侧小字题款与印章，纸外有深绿装裱边 + 大面积黑底。"
            "v11 修复目标图：深色装裱边 + 黑底使全图暗色占比达 66% > 60%，骗过 buildInkMask 反色判据"
            "（误当成黑底白字拓片），反色后「墨迹」变成白纸而非黑字，旧结果竖排 2 列 16 框、每框约 1.5 字、"
            "框线穿字，题款印章未框出。现由 detectContentBorder 检测浅色纸区包围盒（四重守卫：内容区 <92% 全图、"
            "左右各内缩 ≥4%、区内浅色 ≥50%、区外暗色 ≥60%），命中时只在纸区内重算 Otsu（阈值由 123 变 145）、"
            "边框零化，不再误反色。竖排 4 列 23 框：右联 12 框每框一字，左联 11 框（「觀其」因空边距改变投影分位"
            "阈值、列带略宽而合并为一框，可在编辑态拆分）；题款小字与印章仍未框出。free 与 grid 两个 case 守住"
            "有格开关不改变结果。已知瑕疵：左联「觀其」合并、题款印章未识别。"
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


def detect_content_border(gray, W, H, threshold):
    """镜像 segment.js 的 detectContentBorder：找浅色纸区包围盒，四重守卫防误裁。"""
    light = gray > threshold
    ys, xs = np.where(light)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max() + 1)
    y0, y1 = int(ys.min()), int(ys.max() + 1)
    region_area = (x1 - x0) * (y1 - y0)
    if region_area > W * H * 0.92:
        return None
    if not (x0 > W * 0.04 and x1 < W * 0.96):
        return None
    if light[y0:y1, x0:x1].mean() < 0.5:
        return None
    outside = np.ones((H, W), bool)
    outside[y0:y1, x0:x1] = False
    if not outside.any() or (gray[outside] < threshold).mean() < 0.6:
        return None
    return (x0, y0, x1, y1)


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
    full_th = otsu(hist, W * H)
    # 装裱边框检测：命中时只在浅色纸区内算阈值/墨迹，边框零化（与 JS 一致）
    border = detect_content_border(gray, W, H, full_th)
    if border:
        x0, y0, x1, y1 = border
        region = gray[y0:y1, x0:x1]
        th = otsu(np.bincount(region.ravel(), minlength=256), region.size)
        region_area = region.size
    else:
        x0, y0, x1, y1 = 0, 0, W, H
        th = full_th
        region_area = W * H
    ink = np.zeros((H, W), dtype=np.uint8)
    sub = (gray[y0:y1, x0:x1] < th).astype(np.uint8)
    ink_count = int(sub.sum())
    inverted = False
    if ink_count > region_area * 0.6:
        sub = 1 - sub
        inverted = True
    ink[y0:y1, x0:x1] = sub

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
    # 边框区域的 faint 零化（与 JS 只在内容区循环一致）
    if border:
        region_mask = np.zeros((H, W), dtype=np.uint8)
        region_mask[y0:y1, x0:x1] = 1
        faint = faint * region_mask

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
