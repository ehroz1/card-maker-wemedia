#!/usr/bin/env python3
"""
Собирает всё приложение в один index.html для GitHub Pages.

Что берёт:
    src/            — код (render.js, app.js, styles.css, index.template.html)
    brand/          — логотипы и затемнение
    brand/fonts/    — шрифты

Запуск:  python3 build.py
Результат: index.html в корне
"""

import base64
import mimetypes
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
BRAND = HERE / "brand"
FONTS = BRAND / "fonts"
OUT = HERE / "index.html"

# какие символы оставляем в шрифте: латиница, кириллица, цифры, пунктуация
SUBSET_UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,"
    "U+2010-2015,U+2018-201F,U+2026,U+20BD,U+2116,U+2212"
)

IMAGE_EXT = (".png", ".webp", ".jpg", ".jpeg", ".svg")
FONT_EXT = (".woff2", ".ttf", ".otf")


def find_one(folder: Path, stems, exts) -> Path | None:
    """Ищет файл по списку возможных имён, без учёта регистра."""
    if not folder.exists():
        return None
    for stem in stems:
        for f in sorted(folder.iterdir()):
            if not f.is_file():
                continue
            if f.suffix.lower() not in exts:
                continue
            if f.stem.lower().replace(" ", "").replace("-", "_") == stem:
                return f
    return None


def data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix.lower() == ".svg":
        mime = "image/svg+xml"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def subset_font(path: Path) -> bytes:
    """Урезает шрифт до нужных символов и переводит в woff2. Без fontTools — как есть."""
    if path.suffix.lower() == ".woff2":
        return path.read_bytes()
    try:
        from fontTools import subset  # noqa: F401
    except ImportError:
        print(f"  ! fontTools не установлен, {path.name} встраивается целиком")
        print("    (поставь: pip3 install fonttools brotli — файл станет меньше)")
        return path.read_bytes()

    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "out.woff2"
        cmd = [
            sys.executable, "-m", "fontTools.subset", str(path),
            f"--unicodes={SUBSET_UNICODES}",
            "--flavor=woff2",
            f"--output-file={dst}",
            "--layout-features=kern,liga",
            "--no-hinting",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not dst.exists():
            print(f"  ! не удалось урезать {path.name}, встраиваю целиком")
            return path.read_bytes()
        return dst.read_bytes()


def font_face(weight: int, data: bytes, is_woff2: bool, italic: bool = False) -> str:
    fmt = "woff2" if is_woff2 else "truetype"
    mime = "font/woff2" if is_woff2 else "font/ttf"
    b64 = base64.b64encode(data).decode("ascii")
    style = "italic" if italic else "normal"
    return (
        "@font-face{font-family:'CardFont';"
        f"font-weight:{weight};font-style:{style};font-display:block;"
        f"src:url(data:{mime};base64,{b64}) format('{fmt}')}}"
    )


def collect_icons() -> str:
    """Собирает иконки из brand/icons/ в объект ICONS для интерфейса."""
    icons = {}
    folder = BRAND / "icons"
    if folder.exists():
        for f in sorted(folder.glob("*.svg")):
            svg = f.read_text(encoding="utf-8").strip()
            svg = " ".join(svg.split())
            icons[f.stem] = svg
    print(f"иконок:           {len(icons)}")
    body = ",\n".join(f"  {k!r}: {v!r}" for k, v in icons.items())
    return "const ICONS = {\n" + body + "\n};\n"


def main() -> int:
    if not SRC.exists():
        print("нет папки src/ — запусти скрипт из корня проекта")
        return 1

    # ---------- шрифты
    title_font = find_one(FONTS, ["title", "bold", "raleway_bold"], FONT_EXT)
    body_font = find_one(FONTS, ["body", "medium", "regular", "raleway_medium"], FONT_EXT)
    italic_font = find_one(FONTS, ["italic", "semibolditalic", "raleway_semibolditalic"], FONT_EXT)

    if not title_font or not body_font:
        have = [f.name for f in FONTS.iterdir()] if FONTS.exists() else []
        print("не нашёл шрифты в brand/fonts/")
        print("нужны два файла: title.ttf (для заголовков) и body.ttf (для текста)")
        print("сейчас там:", ", ".join(have) or "пусто")
        return 1

    print(f"шрифт заголовков: {title_font.name}")
    print(f"шрифт текста:     {body_font.name}")

    title_data = subset_font(title_font)
    body_data = subset_font(body_font)
    title_woff2 = title_font.suffix.lower() == ".woff2" or len(title_data) < title_font.stat().st_size
    body_woff2 = body_font.suffix.lower() == ".woff2" or len(body_data) < body_font.stat().st_size

    faces = font_face(700, title_data, title_woff2) + "\n" + font_face(500, body_data, body_woff2)

    if italic_font:
        print(f"шрифт курсива:    {italic_font.name}")
        italic_data = subset_font(italic_font)
        italic_woff2 = italic_font.suffix.lower() == ".woff2" or len(italic_data) < italic_font.stat().st_size
        faces += "\n" + font_face(600, italic_data, italic_woff2, italic=True)
    else:
        print("шрифт курсива:    — нет файла, курсив будет наклонён программно")

    # ---------- файлы бренда
    brand = {}
    for key, stems in (
        ("logo", ["logo", "logo_light", "logo_white"]),
        ("logoDark", ["logo_dark", "logo_black", "logodark"]),
    ):
        found = find_one(BRAND, stems, IMAGE_EXT)
        brand[key] = data_url(found) if found else None
        print(f"{key:9s}: {found.name if found else '— нет файла, можно загрузить в самом приложении'}")

    bundled = "const BUNDLED_BRAND = {\n"
    for key, value in brand.items():
        js_value = ('"' + value + '"') if value else "null"
        bundled += f"  {key}: {js_value},\n"
    bundled += "};\n"

    # ---------- сборка
    html = (SRC / "index.template.html").read_text(encoding="utf-8")
    html = html.replace("__FONT_FACES__", faces)
    html = html.replace("__CSS__", (SRC / "styles.css").read_text(encoding="utf-8"))
    html = html.replace("__BUNDLED_BRAND__", bundled)
    html = html.replace("__ICONS__", collect_icons())
    html = html.replace("__RENDER_JS__", (SRC / "render.js").read_text(encoding="utf-8"))
    html = html.replace("__EDITOR_JS__", (SRC / "editor.js").read_text(encoding="utf-8"))
    html = html.replace("__APP_JS__", (SRC / "app.js").read_text(encoding="utf-8"))

    for token in ("__FONT_FACES__", "__CSS__", "__BUNDLED_BRAND__", "__ICONS__",
                  "__RENDER_JS__", "__EDITOR_JS__", "__APP_JS__"):
        if token in html:
            print(f"ошибка сборки: не подставлено {token}")
            return 1

    OUT.write_text(html, encoding="utf-8")
    print(f"\nготово: {OUT.name}  ({OUT.stat().st_size / 1024:.0f} КБ)")
    print("залей в репозиторий и включи GitHub Pages — см. README.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
