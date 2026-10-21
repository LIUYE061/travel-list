"""由 出行清单MVP.html 生成部署入口 index.html，注入 PWA 元信息。

源文件保持"单文件零依赖"不变；只有部署副本才引用 manifest 与图标。
所有引用一律用相对路径（./），这样在 Pages 的 /travel-list/ 子路径下
和局域网服务的根路径下都能解析到正确位置。
"""
import hashlib
import io
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="backslashreplace")
# 护栏的报错信息走 stderr；不包这层，重定向或 CI 捕获时中文会按 GBK 输出成乱码，
# 而"报错中止"能给人看的只有这句话。
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="backslashreplace")

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "出行清单MVP.html")
DST = os.path.join(ROOT, "index.html")

# 锚点：源文件里已有的 viewport meta，注入块紧跟其后
ANCHOR = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'

BLOCK = """<meta name="theme-color" content="#2f6bed">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="出行清单">
<link rel="manifest" href="./manifest.json">
<link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="96x96" href="./icons/icon-96.png">
<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png">
<link rel="shortcut icon" href="./favicon.ico">
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">"""

MARKER = '<meta name="theme-color" content="#2f6bed">'

# 护栏要覆盖所有会破坏"单文件零依赖"的痕迹，不能只认 theme-color 一个串：
# 否则源文件被塞进 <link rel="manifest"> 时会被静默放过，产出双 manifest 页。
GUARD_TOKENS = (
    "<link",
    'rel="manifest"',
    "apple-touch-icon",
    "./icons/",
    "theme-color",
    "mobile-web-app-capable",
    "manifest.json",
)


def build():
    html = open(SRC, encoding="utf-8").read()

    leaked = [t for t in GUARD_TOKENS if t in html]
    if leaked:
        raise SystemExit("SRC 含部署层专用标记，中止（源文件必须保持单文件零依赖）："
                         + " / ".join(leaked))
    if html.count(ANCHOR) != 1:
        raise SystemExit("找不到唯一 viewport 锚点，源文件结构已变，需人工确认注入位置")

    out = html.replace(ANCHOR, ANCHOR + "\n" + BLOCK)
    with open(DST, "wb") as f:
        f.write(out.encode("utf-8"))
    return html, out


def sha8(b):
    return hashlib.sha256(b).hexdigest()[:8]


if __name__ == "__main__":
    src_text = open(SRC, "rb").read()
    before = open(DST, "rb").read() if os.path.exists(DST) else b""

    _, out = build()
    after = open(DST, "rb").read()

    print("src sha8     =", sha8(src_text))
    print("index sha8   =", sha8(after))
    print("injected     =", sha8(after) != sha8(src_text))
    # 幂等性：同一源文件重复生成必须字节一致
    build()
    again = open(DST, "rb").read()
    print("idempotent   =", again == after)
    print("changed      =", again != before if before else "first-run")
    print("bytes        =", len(src_text), "->", len(again))
