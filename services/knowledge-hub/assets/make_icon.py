#!/usr/bin/env python
"""Generate assets/kh.ico — the KnowledgeHub 'KH' badge used by the tray icon
and the Windows shortcut. Re-run only if you want to regenerate the icon:

    .venv\\Scripts\\python.exe assets\\make_icon.py
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = max(1, size // 32)
    radius = max(3, size // 5)
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad], radius=radius, fill=(37, 99, 235, 255)
    )
    text = "KH"
    # Scale a bitmap font up by rendering on a small canvas then resizing would
    # blur; instead just centre the default font — good enough at icon sizes.
    bbox = draw.textbbox((0, 0), text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]),
        text,
        fill=(255, 255, 255, 255),
    )
    return img


def main() -> None:
    base = render(256)
    out = os.path.join(HERE, "kh.ico")
    base.save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", out)


if __name__ == "__main__":
    main()
