import base64, json, sys
from PIL import Image, ImageDraw

raw = open(sys.argv[1], encoding="utf-8").read().strip()
data = json.loads(raw[len("LAYOUT "):])
open(sys.argv[2] + "/page.png", "wb").write(base64.b64decode(data["png"]))
im = Image.open(sys.argv[2] + "/page.png").convert("RGB")
d = ImageDraw.Draw(im)
for r in data["tabs"]:
    for kind, color, dw, dh in (("sign", (220, 0, 0), 120, 44), ("date", (0, 90, 220), 80, 16)):
        for t in r.get(kind) or []:
            x, y = float(t["xPosition"]), float(t["yPosition"])
            w = float(t.get("width") or dw); h = float(t.get("height") or dh)
            d.rectangle([x, y, x + w, y + h], outline=color, width=2)
            print(kind, r["recipient"], "x", x, "y", y, "w", w, "h", h)
im.save(sys.argv[2] + "/overlay.png")
print(im.size)
