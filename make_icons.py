"""生成 PWA 图标：渐变圆角底 + 白色行李箱图形。

不依赖字体（避免 emoji 字体缺失导致图标变豆腐块），全部用几何图形绘制。
- icon-192 / icon-512 : purpose=any，圆角 + 透明四角
- maskable-512        : purpose=maskable，满幅不透明，图形收在 80% 安全区内
- apple-touch-icon    : 180 满幅不透明（iOS 自己裁圆，透明区会变白边）
- favicon-32          : 32 圆角

抗锯齿：ImageDraw 画的圆角/直线在最终尺寸下是硬边缘（alpha 只有 0 和 255 两值），
32px 下轮廓会读成八边形。因此图形层与圆角遮罩都在 8x 超采样画布上绘制，
再用 LANCZOS 降采样，让边缘产生真实灰度过渡。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

SS = 8                      # 超采样倍数
C1 = (0x2F, 0x6B, 0xED)     # --primary
C2 = (0x6A, 0x55, 0xE6)     # hero 渐变末端
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(size):
    """底色渐变按最终尺寸逐像素生成（26 万次的量级，够快）。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    span = 2 * (size - 1) or 1
    for y in range(size):
        for x in range(size):
            px[x, y] = lerp(C1, C2, (x + y) / span)
    return img


def draw_suitcase(dr, size, frac):
    """frac: 图形占画布的比例。maskable 要缩小以留 80% 安全区。"""
    cx = cy = size / 2
    gh = size * frac
    handle_h = gh * 0.24
    body_h = gh - handle_h
    body_w = gh * 1.02
    top = cy - gh / 2
    body_top = top + handle_h
    mid = lerp(C1, C2, 0.5) + (255,)

    # 提手：只画轮廓，下半段会被箱体盖住
    hw = body_w * 0.36
    dr.rounded_rectangle(
        [cx - hw / 2, top, cx + hw / 2, body_top + body_h * 0.18],
        radius=hw * 0.30, outline=WHITE, width=max(2, int(gh * 0.055)),
    )
    # 箱体
    dr.rounded_rectangle(
        [cx - body_w / 2, body_top, cx + body_w / 2, body_top + body_h],
        radius=body_h * 0.17, fill=WHITE,
    )
    # 两条竖向束带：用渐变中位色挖出来，形成行李箱分格观感
    sw = gh * 0.055
    for dx in (-body_w * 0.21, body_w * 0.21):
        dr.rectangle([cx + dx - sw / 2, body_top, cx + dx + sw / 2, body_top + body_h], fill=mid)
    # 拉链横线
    dr.line([cx - body_w / 2, body_top + body_h * 0.34, cx + body_w / 2, body_top + body_h * 0.34],
            fill=mid, width=max(1, int(gh * 0.022)))


def make(size, *, full_bleed=False, glyph=0.62, radius=0.225):
    hi = size * SS
    base = gradient(size).convert("RGBA")

    layer = Image.new("RGBA", (hi, hi), (0, 0, 0, 0))
    draw_suitcase(ImageDraw.Draw(layer), hi, glyph)
    out = Image.alpha_composite(base, layer.resize((size, size), Image.LANCZOS))

    if not full_bleed:
        mask = Image.new("L", (hi, hi), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, hi - 1, hi - 1], radius=int(hi * radius), fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


targets = [
    ("icon-48.png", make(48, glyph=0.64)),
    ("icon-96.png", make(96, glyph=0.63)),
    ("icon-192.png", make(192)),
    ("icon-512.png", make(512)),
    ("maskable-512.png", make(512, full_bleed=True, glyph=0.50)),
    ("apple-touch-icon.png", make(180, full_bleed=True, glyph=0.58)),
    ("favicon-32.png", make(32, glyph=0.66, radius=0.20)),
]

for name, img in targets:
    img.save(os.path.join(OUT, name), "PNG")
    print("%-22s %sx%s  mode=%s" % (name, img.size[0], img.size[1], img.mode))

# 桌面快捷方式在不少浏览器里取 favicon 而非 manifest 图标，32px 放到启动器上会糊。
# 额外写一个多尺寸 favicon.ico 放在仓库根，兜住"浏览器直接请求 /favicon.ico"这条路径。
ico_src = make(48, glyph=0.64)
ico_path = os.path.join(ROOT, "favicon.ico")
ico_src.save(ico_path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])
print("%-22s -> %s bytes" % ("favicon.ico", os.path.getsize(ico_path)))
