"""Draws the BookCloset app icon (cabinet with leaning book spines) → build/icon.png + build/icon.ico."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'build'
OUT.mkdir(exist_ok=True)
S = 2048  # supersampled canvas


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return m


def spine(w, h, color, band):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], int(w * 0.16), fill=color)
    # cloth shading: darker edges, light center ridge
    for x in range(w):
        t = abs(x / (w - 1) - 0.42) * 2
        shade = int(38 * t ** 1.6)
        d.line([(x, int(w * 0.16)), (x, h - int(w * 0.16))], fill=(*lerp(color[:3], (0, 0, 0), shade / 255), 255))
    d.rounded_rectangle([0, 0, w - 1, h - 1], int(w * 0.16), outline=(0, 0, 0, 40), width=3)
    # gilt bands
    for y in (int(h * 0.12), int(h * 0.82)):
        d.rectangle([int(w * 0.14), y, int(w * 0.86), y + int(h * 0.025)], fill=band)
    d.rectangle([int(w * 0.24), int(h * 0.36), int(w * 0.76), int(h * 0.5)], fill=(*band[:3], 150))
    return img


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# background tile: warm amber → oxblood diagonal gradient
bg = Image.new('RGBA', (S, S))
px = bg.load()
c1, c2 = (198, 102, 42), (104, 34, 30)
for y in range(S):
    for x in range(0, S, 4):
        t = min(1, max(0, (x * 0.45 + y * 0.75) / (S * 1.15)))
        c = lerp(c1, c2, t)
        for k in range(4):
            if x + k < S:
                px[x + k, y] = (*c, 255)
pad = int(S * 0.06)
tile_size = S - 2 * pad
radius = int(tile_size * 0.23)
tile = bg.crop((0, 0, tile_size, tile_size))
gloss = Image.new('RGBA', (tile_size, tile_size), (0, 0, 0, 0))
gd = ImageDraw.Draw(gloss)
gd.ellipse([-tile_size * 0.3, -tile_size * 0.65, tile_size * 1.1, tile_size * 0.45], fill=(255, 236, 200, 34))
tile = Image.alpha_composite(tile, gloss)
mask = rounded_mask(tile_size, radius)

# soft drop shadow
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + int(S * 0.018), S - pad, S - pad + int(S * 0.018)], radius, fill=(40, 12, 6, 120))
shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.02))
img = Image.alpha_composite(img, shadow)
img.paste(tile, (pad, pad), mask)

# books
cream = (251, 243, 227, 255)
gold = (214, 168, 92, 255)
books = Image.new('RGBA', (S, S), (0, 0, 0, 0))
base_y = int(S * 0.735)
specs = [
    (0.255, 0.115, 0.43, (246, 236, 214, 255), 0),
    (0.385, 0.115, 0.50, (236, 222, 196, 255), 0),
    (0.515, 0.13, 0.46, cream, 0),
]
for (x, w, h, col, _r) in specs:
    sw, sh = int(S * w), int(S * h)
    sp = spine(sw, sh, col, gold)
    books.alpha_composite(sp, (int(S * x), base_y - sh))
# leaning book
lw, lh = int(S * 0.115), int(S * 0.45)
lean = spine(lw, lh, (240, 228, 205, 255), gold).rotate(-17, resample=Image.BICUBIC, expand=True)
books.alpha_composite(lean, (int(S * 0.635), base_y - lean.height + int(S * 0.006)))
# shelf
sd = ImageDraw.Draw(books)
sd.rounded_rectangle([int(S * 0.2), base_y, int(S * 0.8), base_y + int(S * 0.045)], int(S * 0.012), fill=(253, 246, 232, 255))
# book shadows
bshadow = books.split()[3].point(lambda a: 90 if a > 0 else 0)
sh_img = Image.new('RGBA', (S, S), (50, 14, 8, 0))
sh_img.putalpha(bshadow)
sh_img = sh_img.filter(ImageFilter.GaussianBlur(S * 0.012))
img.alpha_composite(sh_img, (0, int(S * 0.012)))
img.alpha_composite(books)

final = img.resize((1024, 1024), Image.LANCZOS)
final.save(OUT / 'icon.png')
final.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png')
sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (96, 96), (128, 128), (256, 256)]
final.save(OUT / 'icon.ico', sizes=sizes)
print('icon written', OUT)
