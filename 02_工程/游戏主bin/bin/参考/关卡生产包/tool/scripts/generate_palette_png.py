from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json
import math
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
LIB_PATH = ROOT / "config" / "标准色库毛线真实.txt"
FAMILIES = [{1, 4, 6}, {20, 21, 23}, {3, 5, 27}, {31, 32}, {33, 15, 16, 18}]
CLOSE_PAIRS = [(8, 10), (7, 17), (3, 8), (14, 23), (17, 18), (10, 11)]
SOFT_AVOID = {2}
TYPE_GROUPS = [
    ("红/粉系", [1, 2, 3, 4, 5, 6, 12]),
    ("紫系", [7, 8, 9, 10, 11, 16, 17, 18]),
    ("蓝/青系", [13, 14, 15, 21, 23, 33]),
    ("绿色系", [19, 20, 22, 24]),
    ("黄/橙系", [25, 26, 27, 28, 29, 30]),
    ("浅色/灰白系", [31, 32, 34]),
]


def load_lib():
    colors = {}
    for line in LIB_PATH.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(#[0-9a-fA-F]{6})\s*,\s*(\d+)$", line.strip())
        if m:
            colors[int(m.group(2))] = m.group(1).upper()
    return colors


LIB = load_lib()
ALL_IDS = sorted(LIB)


def rgb(hex_value):
    h = hex_value.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def hsl(color_id):
    r, g, b = [v / 255 for v in rgb(LIB.get(color_id, "#CCCCCC"))]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    l = (mx + mn) / 2
    if d == 0:
        return 0, 0, l
    s = d / (1 - abs(2 * l - 1)) if 1 - abs(2 * l - 1) else 0
    if mx == r:
        hh = ((g - b) / d) % 6
    elif mx == g:
        hh = (b - r) / d + 2
    else:
        hh = (r - g) / d + 4
    return (hh * 60) % 360, s, l


def hue_dist(a, b):
    d = abs(hsl(a)[0] - hsl(b)[0])
    return min(d, 360 - d)


def sat_dist(a, b):
    return abs(hsl(a)[1] - hsl(b)[1])


def rgb_dist(a, b):
    ra, rb = rgb(LIB.get(a, "#CCCCCC")), rgb(LIB.get(b, "#CCCCCC"))
    return math.sqrt(sum((ra[i] - rb[i]) ** 2 for i in range(3)))


def min_dist(c, selected, metric):
    return min([metric(c, x) for x in selected], default=float("inf"))


def family(c):
    for f in FAMILIES:
        if c in f:
            return f
    return None


def is_close(c, selected):
    return any((c == a and b in selected) or (c == b and a in selected) for a, b in CLOSE_PAIRS)


def conflicts(c, selected):
    f = family(c)
    return bool((f and any(x in f for x in selected)) or is_close(c, selected))


def type_name(c):
    for name, ids in TYPE_GROUPS:
        if c in ids:
            return name
    return "其他"


def prefer_non_avoid(candidates):
    preferred = [c for c in candidates if c not in SOFT_AVOID]
    return preferred or candidates


def parse_txt(path):
    ids = []
    for line in path.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if re.fullmatch(r"\d+(\s+\d+)*", t):
            ids += [int(x) for x in t.split() if int(x) > 0]
    return ids


def parse_json_ids(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    ids = []
    for row in data.get("blocks", []):
        for cell in row:
            if cell.get("id", 0) > 0:
                ids.append(cell["id"])
    return ids


def counts(ids):
    out = {}
    for i in ids:
        out[i] = out.get(i, 0) + 1
    return out


def candidate_scope(txt_unique):
    target = len(txt_unique) // 2 if len(txt_unique) > 5 else min(len(txt_unique), 8, 2)
    selected = []
    while len(selected) < min(len(txt_unique), 8, target):
        candidates = [c for c in txt_unique if c not in selected and not conflicts(c, selected)]
        candidates = prefer_non_avoid(candidates)
        if candidates:
            type_counts = {}
            for c in selected:
                type_counts[type_name(c)] = type_counts.get(type_name(c), 0) + 1
            mn = min(type_counts.get(type_name(c), 0) for c in candidates)
            candidates = [c for c in candidates if type_counts.get(type_name(c), 0) == mn]
        if not candidates:
            break
        candidates = sorted(
            candidates,
            key=lambda c: (
                -min_dist(c, [x for x in txt_unique if x != c] + selected, sat_dist),
                -min_dist(c, [x for x in txt_unique if x != c] + selected, hue_dist),
                -min_dist(c, [x for x in txt_unique if x != c] + selected, rgb_dist),
                c,
            ),
        )
        selected.append(candidates[0])
    new = [c for c in ALL_IDS if c not in txt_unique and not conflicts(c, txt_unique)]
    return sorted(set(selected + prefer_non_avoid(new)))


def load_font(size):
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ]:
        try:
            return ImageFont.truetype(p, size=size, index=0)
        except Exception:
            pass
    return ImageFont.load_default()


F_TITLE = load_font(34)
F_HEAD = load_font(26)
F_TEXT = load_font(18)
F_SMALL = load_font(15)


def text_color(hex_value):
    r, g, b = rgb(hex_value)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return (255, 255, 255) if lum < 145 else (20, 20, 20)


def draw_section(draw, x, y, title, ids, count_map=None, note_map=None, subtitle=None):
    count_map = count_map or {}
    note_map = note_map or {}
    draw.text((x, y), f"{title}（{len(ids)}种）", fill=(20, 20, 20), font=F_HEAD)
    y += 38
    if subtitle:
        draw.text((x, y), subtitle, fill=(90, 90, 90), font=F_SMALL)
        y += 26
    cell_w, cell_h, gap, cols = 122, 96, 12, 8
    for idx, cid in enumerate(ids):
        cx = x + (idx % cols) * (cell_w + gap)
        cy = y + (idx // cols) * (cell_h + gap)
        hx = LIB.get(cid, "#CCCCCC")
        fg = text_color(hx)
        h, s, _ = hsl(cid)
        draw.rounded_rectangle((cx, cy, cx + cell_w, cy + cell_h), radius=9, fill=rgb(hx), outline=(30, 30, 30), width=1)
        draw.text((cx + 9, cy + 7), f"ID {cid}", fill=fg, font=F_TEXT)
        draw.text((cx + 9, cy + 30), hx, fill=fg, font=F_SMALL)
        draw.text((cx + 9, cy + 49), type_name(cid), fill=fg, font=F_SMALL)
        draw.text((cx + 9, cy + 67), f"纯{s:.2f} 色{int(h)}", fill=fg, font=F_SMALL)
        bits = []
        if cid in count_map:
            bits.append(f"组{count_map[cid]}")
        if cid in note_map:
            bits.append(note_map[cid])
        if bits:
            draw.text((cx + 9, cy + 82), " ".join(bits), fill=fg, font=F_SMALL)
    return y + max(1, math.ceil(len(ids) / cols)) * (cell_h + gap) + 26


def make_images(input_dir, output_dir, png_dir):
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    png_dir = Path(png_dir)
    png_dir.mkdir(parents=True, exist_ok=True)
    summary_file = output_dir / "color_selection_summary.json"
    if not summary_file.exists():
        raise SystemExit(f"缺少 {summary_file}")
    summary = json.loads(summary_file.read_text(encoding="utf-8"))
    md = "| 序号 | 原始TXT | JSON文件 | PNG检查图 | 候选色 | 最终选定补充色 | 禁用近似对检查 | 相邻同色系检查 |\n"
    md += "|---:|---:|---|---|---|---|---|---|\n"
    for idx, item in enumerate(summary, 1):
        json_file = item["output"]
        orig = Path(item["source"]).stem
        txt_ids = parse_txt(input_dir / f"{orig}.txt")
        final_ids = parse_json_ids(output_dir / json_file)
        txt_unique = sorted(set(txt_ids))
        final_unique = sorted(set(final_ids))
        txt_count = counts(txt_ids)
        final_count = counts(final_ids)
        selected = item["colorSequence"]
        cand = candidate_scope(txt_unique)
        selected_notes = {c: ("TXT重叠" if c in txt_unique else "新增") for c in selected}
        final_notes = {}
        for c in final_unique:
            if c in txt_count and final_count.get(c, 0) > txt_count.get(c, 0):
                final_notes[c] = f"+{final_count[c] - txt_count[c]}"
        pair_bad = [f"{a}/{b}" for a, b in CLOSE_PAIRS if a in selected and b in selected]
        adj = [f"{selected[i-1]}/{selected[i]}" for i in range(1, len(selected)) if type_name(selected[i-1]) == type_name(selected[i])]
        check = f"覆盖 {len(set(type_name(c) for c in selected))} 个色系；禁用近似对：{','.join(pair_bad) if pair_bad else '通过'}；相邻同色系：{','.join(adj) if adj else '通过'}"
        sections = [
            ("原始 TXT 文件包含的颜色", txt_unique, txt_count, {}, "直接从 TXT 像素矩阵读取"),
            ("选择补充颜色的候选色", cand, None, {}, "包含 TXT 重叠候选和可新增候选；已排除互斥色、强近似色对，并优先分散色系"),
            ("最终选定的补充颜色", selected, final_count, selected_notes, "真实生成时选择的 colorSequence；" + check),
            ("整个关卡最后所有包含的颜色", final_unique, final_count, final_notes, "从最终 JSON 目标区统计；+ 表示比原始 TXT 增加的组数"),
        ]
        width, y = 1160, 94
        for _, ids, _, _, sub in sections:
            y += 38 + (26 if sub else 0) + max(1, math.ceil(len(ids) / 8)) * (96 + 12) + 26 + 22
        image = Image.new("RGB", (width, max(860, y + 20)), (250, 250, 250))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, width, 70), fill=(36, 38, 42))
        draw.text((28, 16), f"{idx:03d} / {orig}.txt 色库检查图", fill=(255, 255, 255), font=F_TITLE)
        draw.text((650, 25), json_file, fill=(220, 220, 220), font=F_TEXT)
        y = 98
        for title, ids, count_map, note_map, sub in sections:
            draw.rounded_rectangle((20, y - 14, width - 20, y + 20), radius=8, fill=(238, 240, 242))
            y = draw_section(draw, 38, y - 4, title, ids, count_map, note_map, sub) + 22
        out = png_dir / f"{idx:03d}_{orig}_色库检查.png"
        image.save(out)
        md += f"| {idx} | {orig} | {json_file} | {png_dir.name}/{out.name} | {' '.join(map(str, cand))} | {' '.join(map(str, selected))} | {','.join(pair_bad) if pair_bad else '通过'} | {','.join(adj) if adj else '通过'} |\n"
    (ROOT / "PNG色库检查汇总.md").write_text(md, encoding="utf-8")
    print(f"已生成 PNG 色库检查图：{len(summary)} 张")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("用法：python3 tool/scripts/generate_palette_png.py <input_txt目录> <output_json目录> <png输出目录>")
    make_images(sys.argv[1], sys.argv[2], sys.argv[3])
