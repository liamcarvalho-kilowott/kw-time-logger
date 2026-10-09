"""Draws the toolbar icon: a neubrutalist yellow tile with a hard shadow and a black lightning bolt."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
VOLT, INK = (255, 214, 10), (17, 17, 17)

# Lightning bolt on a 0..1 grid.
BOLT = [(0.60, 0.08), (0.24, 0.56), (0.47, 0.56), (0.38, 0.92), (0.78, 0.40), (0.54, 0.40), (0.66, 0.08)]

def draw(size: int) -> Image.Image:
    s = 8  # supersample for smooth edges
    n = size * s
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    border = max(n * 0.07, s * 1.5)
    shadow = n * (0.08 if size >= 32 else 0.06)
    tile = n - shadow - 1
    radius = n * 0.12
    d.rounded_rectangle([shadow, shadow, n - 1, n - 1], radius=radius, fill=INK)  # hard offset shadow
    d.rounded_rectangle([0, 0, tile, tile], radius=radius, fill=INK)
    d.rounded_rectangle([border, border, tile - border, tile - border], radius=max(radius - border, 0), fill=VOLT)
    pad = border + tile * 0.06
    inner = tile - 2 * pad
    d.polygon([(pad + x * inner, pad + y * inner) for x, y in BOLT], fill=INK)
    return img.resize((size, size), Image.LANCZOS)

OUT.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    draw(size).save(OUT / f"icon{size}.png")
print("icons written to", OUT)
