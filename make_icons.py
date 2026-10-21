"""生成 PWA 图标：渐变圆角底 + 白色行李箱图形。

不依赖字体（避免 emoji 字体缺失导致图标变豆腐块），全部用几何图形绘制。
- icon-192 / icon-512 : purpose=any，圆角 + 透明四角
- maskable-512        : purpose=maskable，满幅不透明，图形收在 80% 安全区内
- apple-touch-icon    : 180 满幅不透明（iOS 自己裁圆，透明区会变白边）
- favicon-32          : 32 圆角
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

C1 = (0x2F, 0x6B, 0xED)   # --primary
C2 = (0x6A, 0x55, 0xE6)   # hero 渐变末端
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    span = 2 * (size - 1) or 1
    for y in range(size):
        for x in range(size):
            px[x, y] = lerp(C1, C2, (x + y) / span)
    return img


def draw_suitcase(img, frac):
    """frac: 图形占画布的比例。maskable 要缩小以留安全区。"""
    size = img.size[0]
    cx = cy = size / 2
    gh = size * frac
    handle_h = gh * 0.24
    body_h = gh - handle_h
    body_w = gh * 1.02
    top = cy - gh / 2
    body_top = top + handle_h
    r = ImageDraw.Draw(img)

    # 提手：只画轮廓，下半段被箱体盖住
    hw = body_w * 0.36
    r.rounded_rectangle(
        [cx - hw / 2, top, cx + hw / 2, body_top + body_h * 0.18],
        radius=hw * 0.30, outline=WHITE, width=max(2, int(gh * 0.055)),
    )
    # 箱体
    r.rounded_rectangle(
        [cx - body_w / 2, body_top, cx + body_w / 2, body_top + body_h],
        radius=body_h * 0.17, fill=WHITE,
    )
    # 两条竖向束带：用底色挖出来，形成行李箱的分格观感
    mid = lerp(C1, C2, 0.5) + (255,)
    sw = gh * 0.055
    for dx in (-body_w * 0.21, body_w * 0.21):
        r.rectangle([cx + dx - sw / 2, body_top, cx + dx + sw / 2, body_top + body_h], fill=mid)
    # 拉链横线
    r.line([cx - body_w / 2, body_top + body_h * 0.34, cx + body_w / 2, body_top + body_h * 0.34],
           fill=mid, width=max(1, int(gh * 0.022)))


def rounded_alpha(size, radius_frac):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=255)
    return mask


def make(size, *, full_bleed=False, glyph=0.62, radius=0.225):
    img = gradient(size).convert("RGBA")
    draw_suitcase(img, glyph)
    if not full_bleed:
        img.putalpha(rounded_alpha(size, radius))
    return img


targets = [
    ("icon-192.png", make(192)),
    ("icon-512.png", make(512)),
    ("maskable-512.png", make(512, full_bleed=True, glyph=0.50)),
    ("apple-touch-icon.png", make(180, full_bleed=True, glyph=0.58)),
    ("favicon-32.png", make(32, glyph=0.66, radius=0.20)),
]

for name, img in targets:
    img.save(os.path.join(OUT, name), "PNG")
    print("%-22s %sx%s  mode=%s" % (name, img.size[0], img.size[1], img.mode))
