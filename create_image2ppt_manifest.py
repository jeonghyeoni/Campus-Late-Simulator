from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


PROJECT = Path(r"C:\Users\jeonghyeon\.codex\skills\bggg-creator-image2ppt\projects\20260519_ppt_images")
ORIG = PROJECT / "original_inputs"
COMP = PROJECT / "component_images"
MANIFEST = PROJECT / "manifest.json"
NOTES = PROJECT / "process_notes.md"

CANVAS_W = 1600
CANVAS_H = 900
GREEN = "#00845f"
LIGHT_GREEN = "#e9f5f1"
BLACK = "#070707"
TEXT_GRAY = "#5f6368"
MID_GRAY = "#6f7074"
LIGHT_GRAY = "#e6e8eb"
CARD_FILL = "#ffffff"
SOFT_FILL = "#f7f7f7"


def crop(name: str, source: str, box: tuple[int, int, int, int]) -> str:
    COMP.mkdir(parents=True, exist_ok=True)
    out = COMP / name
    with Image.open(ORIG / source) as img:
        img.crop(box).save(out)
    return f"component_images/{name}"


ASSETS = {
    "chatgpt_logo": crop("chatgpt_logo.png", "01.png", (730, 88, 942, 300)),
    "chatgpt_large": crop("chatgpt_large.png", "02.png", (1170, 345, 1548, 723)),
    "google": crop("google_icon.png", "03.png", (156, 555, 333, 733)),
    "naver": crop("naver_icon.png", "03.png", (490, 575, 646, 725)),
    "book": crop("book_icon.png", "04.png", (158, 474, 300, 624)),
    "briefcase": crop("briefcase_icon.png", "04.png", (465, 455, 608, 606)),
    "code": crop("code_icon.png", "04.png", (762, 456, 905, 604)),
    "translate": crop("translate_icon.png", "04.png", (1082, 451, 1225, 616)),
    "chat_icon": crop("chat_icon_black.png", "07.png", (214, 410, 360, 545)),
    "speech_alert": crop("speech_alert.png", "06.png", (960, 183, 1524, 720)),
    "sidebar_icon": crop("sidebar_icon.png", "08.png", (150, 430, 285, 540)),
    "folder_black": crop("folder_black.png", "08.png", (515, 418, 652, 535)),
    "folder_specific": crop("folder_specific.png", "08.png", (887, 420, 1026, 532)),
    "chat_black": crop("chat_black.png", "08.png", (1260, 415, 1392, 546)),
    "context_illustration": crop("context_illustration.png", "09.png", (880, 225, 1435, 760)),
    "improve_folder": crop("improve_folder.png", "10.png", (145, 350, 300, 485)),
    "improve_select": crop("improve_select.png", "10.png", (520, 345, 650, 500)),
    "improve_sliders": crop("improve_sliders.png", "10.png", (870, 355, 1018, 502)),
    "improve_grid": crop("improve_grid.png", "10.png", (1235, 355, 1372, 500)),
    "target": crop("target_icon.png", "11.png", (145, 330, 608, 790)),
    "watermark": crop("thankyou_watermark.png", "12.png", (1068, 360, 1536, 1024)),
    "sparkle_green": crop("sparkle_green.png", "12.png", (115, 170, 260, 310)),
    "sparkle_mint": crop("sparkle_mint.png", "12.png", (280, 90, 370, 190)),
}


def bg() -> dict:
    return {"kind": "background", "fill": "#ffffff", "z": 0}


def text(name: str, value: str, x: int, y: int, w: int, h: int, size: int, *,
         color: str = BLACK, bold: bool = False, align: str = "left", z: int = 10) -> dict:
    return {
        "kind": "text",
        "name": name,
        "text": value,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "font_size_px": size,
        "font_family": "Arial",
        "bold": bold,
        "color": color,
        "align": align,
        "z": z,
    }


def shape(name: str, kind: str, x: int, y: int, w: int, h: int, *,
          fill: str | None = None, stroke: str | None = None, sw: int = 2, z: int = 5) -> dict:
    item = {
        "kind": "shape",
        "name": name,
        "shape": kind,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "z": z,
    }
    if fill is not None:
        item["fill"] = fill
    if stroke is not None:
        item["stroke"] = stroke
        item["stroke_width_px"] = sw
    return item


def line(name: str, x1: int, y1: int, x2: int, y2: int, *,
         stroke: str = BLACK, sw: int = 3, z: int = 6) -> dict:
    return {
        "kind": "shape",
        "name": name,
        "shape": "line",
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "stroke": stroke,
        "stroke_width_px": sw,
        "z": z,
    }


def image(name: str, asset: str, x: int, y: int, w: int, h: int, z: int = 8, fit: str = "contain") -> dict:
    return {
        "kind": "image",
        "name": name,
        "file": ASSETS[asset],
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "fit": fit,
        "z": z,
    }


def card(x: int, y: int, w: int, h: int, name: str = "Card", z: int = 4) -> list[dict]:
    return [
        shape(name, "roundRect", x, y, w, h, fill=CARD_FILL, stroke=LIGHT_GRAY, sw=2, z=z),
    ]


def person(x: int, y: int, color: str, idx: int) -> list[dict]:
    return [
        shape(f"person {idx} head", "ellipse", x + 23, y, 52, 52, fill=color, z=5),
        shape(f"person {idx} body", "roundRect", x + 10, y + 66, 78, 82, fill=color, z=5),
        shape(f"person {idx} leg l", "roundRect", x + 20, y + 130, 28, 76, fill=color, z=5),
        shape(f"person {idx} leg r", "roundRect", x + 51, y + 130, 28, 76, fill=color, z=5),
    ]


def dots(name: str, x: int, y: int, color: str = "#34383d", gap: int = 28, r: int = 13, z: int = 9) -> list[dict]:
    return [shape(f"{name} dot {i+1}", "ellipse", x + i * gap, y, r, r, fill=color, z=z) for i in range(3)]


slides: list[dict] = []

# 01
slides.append({
    "name": "01 Cover",
    "elements": [
        bg(),
        image("ChatGPT logo", "chatgpt_logo", 705, 88, 190, 190),
        text("Title", "The Absence of\nan Efficient Folder System\nin the ChatGPT App", 250, 325, 1100, 280, 74, bold=True, align="center"),
        text("Subtitle", "Usability Issues in Chat Organization\nand Navigation", 390, 660, 820, 115, 40, color="#66696e", align="center"),
    ],
})

# 02
els = [bg(), text("Title", "ChatGPT is used\nby many age groups", 110, 170, 760, 200, 70)]
for i, x in enumerate([115, 245, 375, 505], start=1):
    els += person(x, 440, "#159b7b", i)
for i, x in enumerate([670, 800, 930], start=5):
    els += person(x, 440, "#d7d7d7", i)
els += [
    text("Teens label", "Teens & 20s", 200, 700, 310, 70, 43, color=GREEN, align="center"),
    text("Older label", "40s & 50s", 708, 700, 320, 70, 43, color="#77797d", align="center"),
    image("ChatGPT large logo", "chatgpt_large", 1125, 335, 350, 350),
]
slides.append({"name": "02 Age groups", "elements": els})

# 03
els = [
    bg(),
    text("Title", "People now ask ChatGPT\ninstead of searching", 105, 115, 820, 170, 61, bold=True),
    shape("Search bar", "roundRect", 105, 345, 560, 125, fill="#ffffff", stroke=LIGHT_GRAY, sw=2),
    shape("Search lens ring", "ellipse", 155, 383, 50, 50, stroke="#606167", sw=6, z=7),
    line("Search lens handle", 195, 425, 225, 455, stroke="#606167", sw=6, z=7),
    text("Search placeholder", "Search...", 250, 388, 250, 55, 44, color="#85878c"),
    *card(105, 510, 250, 230, "Google card"),
    *card(420, 510, 250, 230, "Naver card"),
    image("Google logo", "google", 160, 570, 140, 140),
    image("Naver logo", "naver", 490, 575, 120, 120),
    shape("Flow arrow", "rightArrow", 735, 515, 95, 65, fill="#66696e", z=8),
    shape("Chat input", "roundRect", 880, 340, 610, 400, fill="#fbfefd", stroke="#d3e6df", sw=3),
    text("Chat prompt", "How can I help\nyou today?", 940, 420, 420, 160, 54, color="#161b22"),
    shape("Send button", "ellipse", 1330, 585, 105, 105, fill="#009c76", z=8),
    shape("Send arrow", "upArrow", 1360, 615, 45, 55, fill="#ffffff", z=9),
]
slides.append({"name": "03 Search to chat", "elements": els})

# 04
els = [bg(), text("Title", "Students use it for\nmany purposes", 110, 135, 720, 190, 68, bold=True)]
xs = [110, 400, 690, 980, 1270]
assets = ["book", "briefcase", "code", "translate", None]
labels = ["Assignment", "Career", "Coding", "Translation", "More"]
for i, x in enumerate(xs):
    els += card(x, 385, 235, 250, f"Purpose card {i+1}")
    if assets[i]:
        els.append(image(labels[i] + " icon", assets[i], x + 50, 445, 135, 135))
    else:
        els += dots("More", x + 76, 502, color="#25292f", gap=42, r=22)
    els.append(text(labels[i] + " label", labels[i], x - 15, 680, 265, 65, 43, align="center"))
slides.append({"name": "04 Student purposes", "elements": els})

# 05
els = [
    bg(),
    text("Title", "As a result,\nchat rooms increase\nnaturally", 115, 240, 650, 340, 72, bold=True),
    shape("Chat list", "roundRect", 905, 90, 590, 550, fill="#ffffff", stroke=LIGHT_GRAY, sw=2),
    shape("Plus button", "ellipse", 1360, 690, 130, 130, fill="#009c76", z=8),
    text("Plus", "+", 1386, 704, 78, 78, 84, color="#ffffff", align="center", z=9),
]
for i, y in enumerate([92, 228, 364, 500]):
    if i:
        els.append(line(f"Divider {i}", 905, y, 1495, y, stroke=LIGHT_GRAY, sw=2))
    els.append(image(f"Chat row icon {i+1}", "chat_icon", 960, y + 45, 62, 62))
    els.append(text(f"New chat {i+1}", "New chat", 1050, y + 48, 260, 60, 42))
    els += dots(f"Row {i+1} menu", 1390, y + 62, color="#34383d", gap=28, r=13)
slides.append({"name": "05 More chat rooms", "elements": els})

# 06
slides.append({
    "name": "06 Organization problem",
    "elements": [
        bg(),
        text("Title", "Problems occur\nwithout proper\norganization", 115, 285, 760, 320, 72, bold=True),
        image("Speech alert illustration", "speech_alert", 935, 170, 555, 555),
    ],
})

# 07
els = [
    bg(),
    text("Title", "1)  Starting new chats\nevery time", 90, 105, 790, 180, 67, bold=True),
]
for i, x in enumerate([135, 525, 915]):
    els += card(x, 340, 285, 255, f"Chat card {i+1}")
    els.append(image(f"Chat icon {i+1}", "chat_icon", x + 78, 410, 130, 130))
    els.append(text(f"Same topic {i+1}", "Same topic", x + 5, 625, 275, 65, 41, align="center"))
els += dots("More chats", 1300, 470, color="#34383d", gap=44, r=21)
els += [
    shape("Green arrow", "rightArrow", 95, 755, 88, 54, fill=GREEN, z=8),
    text("Finding issue", "Chats scattered & hard to find", 225, 744, 880, 75, 58, color=GREEN),
]
slides.append({"name": "07 Scattered chats", "elements": els})

# 08
els = [
    bg(),
    text("Title", "2)  More navigation steps\nwith Projects", 85, 100, 850, 180, 68, bold=True),
]
xs = [90, 465, 840, 1215]
icon_assets = ["sidebar_icon", "folder_black", "folder_specific", "chat_black"]
labels = ["Sidebar", "Project", "Specific Project", "Chat"]
for i, x in enumerate(xs):
    els += card(x, 355, 250, 220, f"Step card {i+1}")
    els.append(image(f"{labels[i]} icon", icon_assets[i], x + 65, 420, 120, 95))
    els.append(text(f"{labels[i]} label", labels[i], x - 40, 620, 330, 70, 39, align="center"))
for x in [360, 735, 1110]:
    els.append(shape("Step arrow", "rightArrow", x, 445, 75, 50, fill="#62646a", z=8))
els += [
    shape("Green arrow note", "rightArrow", 90, 775, 80, 48, fill=GREEN, z=8),
    text("Steps note", "4 steps vs. 2 steps before", 205, 762, 720, 70, 60, color=GREEN),
]
slides.append({"name": "08 Projects navigation", "elements": els})

# 09
slides.append({
    "name": "09 Context sharing",
    "elements": [
        bg(),
        text("Title", "Not everyone needs\ncontext sharing", 105, 275, 760, 180, 63, bold=True),
        text("Subtitle", "Many users just want\na simple folder system", 105, 548, 720, 150, 54, color=GREEN, bold=True),
        image("Context sharing illustration", "context_illustration", 875, 205, 560, 560),
    ],
})

# 10
els = [bg(), text("Title", "Possible improvements", 115, 130, 760, 95, 69, bold=True)]
xs = [95, 465, 830, 1195]
icons = ["improve_folder", "improve_select", "improve_sliders", "improve_grid"]
labels = [
    "Add a simple\nfolder feature",
    "Support\nmulti-select &\nbulk actions",
    "Reduce steps\nin organizing\nprocess",
    "Simplify\nnavigation\nstructure",
]
for i, x in enumerate(xs):
    els.append(shape(f"Improvement tile {i+1}", "roundRect", x, 280, 275, 250, fill=SOFT_FILL, stroke=SOFT_FILL, sw=1))
    els.append(image(f"Improvement icon {i+1}", icons[i], x + 58, 345, 160, 150))
    els.append(text(f"Improvement label {i+1}", labels[i], x - 10, 575, 295, 165, 42, align="center"))
slides.append({"name": "10 Improvements", "elements": els})

# 11
slides.append({
    "name": "11 Goal",
    "elements": [
        bg(),
        text("Goal label", "Goal", 145, 185, 250, 80, 58, color=GREEN, bold=True),
        image("Target icon", "target", 135, 325, 465, 430),
        text("Goal statement", "Make chat management\nmore intuitive\nand efficient", 735, 370, 720, 260, 58, bold=True),
    ],
})

# 12
slides.append({
    "name": "12 Thank you",
    "elements": [
        bg(),
        image("Green sparkle", "sparkle_green", 120, 175, 120, 120),
        image("Mint sparkle", "sparkle_mint", 286, 90, 80, 80),
        image("ChatGPT watermark", "watermark", 1110, 390, 500, 500),
        text("Thanks", "Thank you!", 370, 335, 850, 105, 82, bold=True, align="center"),
        text("Questions", "Any questions?", 450, 500, 680, 80, 58, color="#394650", align="center"),
    ],
})

manifest = {
    "deck": {
        "canvas_width": CANVAS_W,
        "canvas_height": CANVAS_H,
        "slide_width_in": 13.333,
        "slide_height_in": 7.5,
        "name": "ChatGPT Folder System Usability Issues",
    },
    "slides": slides,
}

MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

notes = f"""# Image2PPT Process Notes

Project: `{PROJECT}`

## Editable Reconstruction

- All readable slide titles, subtitles, labels, row text, and callout text were recreated as native PowerPoint text boxes.
- White backgrounds, rounded cards, list containers, dividers, arrows, ellipses, people icons, buttons, dots, and simple UI frames were recreated as native PowerPoint shapes.
- The deck is generated as 16:9 widescreen using a 1600 x 900 manifest canvas mapped to 13.333 x 7.5 inch slides.

## Image Fallbacks

- Complex brand/icon artwork is kept as separate component images: ChatGPT logos, Google/Naver marks, colorful purpose icons, chat/folder/menu illustrations, the target illustration, sparkles, and the final watermark.
- No slide is pasted as a single full-slide background. Component images are cropped assets placed on top of editable text and shapes.
- No imagegen-generated or imagegen-cleaned assets were required; all image fallbacks came from the provided slide images.

## Known Limits

- PowerPoint-native shapes approximate shadows, icon strokes, and rounded-corner radii; exact soft shadows from the source PNGs are not reproduced.
- Slides 08-12 were originally exported with taller image dimensions, so their content was manually re-laid onto the requested 16:9 slide canvas.
"""
NOTES.write_text(notes, encoding="utf-8")

print(json.dumps({
    "manifest": str(MANIFEST),
    "notes": str(NOTES),
    "slides": len(slides),
    "component_images": len(ASSETS),
}, indent=2))
