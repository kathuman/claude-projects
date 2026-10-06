"""Draws the Sensor Deck launcher icon (a navy tile, a sky-blue phone outline, a pulse line) at every Android density.

Run from phone-sensors/android: python tool/make_icons.py
"""
from PIL import Image, ImageDraw

NAVY, CYAN = (10, 47, 82, 255), (125, 211, 252, 255)
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def icon(px):
    s = 4  # draw large, then scale down for smooth edges
    n = px * s
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=NAVY)
    w = max(2, int(n * 0.055))
    # the phone
    d.rounded_rectangle([n * 0.30, n * 0.14, n * 0.70, n * 0.86], radius=int(n * 0.07), outline=CYAN, width=w)
    d.line([n * 0.45, n * 0.21, n * 0.55, n * 0.21], fill=CYAN, width=w)
    # the pulse across it
    pts = [(n * 0.16, n * 0.56), (n * 0.34, n * 0.56), (n * 0.42, n * 0.40), (n * 0.52, n * 0.68), (n * 0.60, n * 0.48), (n * 0.66, n * 0.56), (n * 0.84, n * 0.56)]
    d.line(pts, fill=CYAN, width=int(w * 1.2), joint="curve")
    return im.resize((px, px), Image.LANCZOS)


for name, px in SIZES.items():
    icon(px).save(f"android/app/src/main/res/mipmap-{name}/ic_launcher.png")
icon(512).save("tool/icon-512.png")
print("icons written")
