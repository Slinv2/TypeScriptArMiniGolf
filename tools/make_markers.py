"""Generates AR.js pattern files (.patt), marker PNGs and printable A4 PDFs."""
# Usage: python tools/make_markers.py   (requires numpy, pillow, reportlab)
# Fonts: DejaVu (adjust the paths below on Windows)
import json, numpy as np, os, sys
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('DV', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "public", "markers")
grids = [np.array(g) for g in json.load(open(os.path.join(os.path.dirname(__file__), 'marker-grids.json')))]
MARKERS = [
  ('A', 'START', 'Tee – the ball starts here', (61, 220, 132)),
  ('B', 'GOAL', 'Hole with flag', (255, 59, 48)),
  ('C', 'OBSTACLE 1', 'Wall', (76, 201, 240)),
  ('D', 'OBSTACLE 2', 'Round bumper', (155, 93, 229)),
  ('E', 'OBSTACLE 3', 'Long wall', (247, 37, 133)),
  ('F', 'OBSTACLE 4', 'Windmill', (255, 210, 63)),
]

def inner(g):  # 1 = schwarz
    return (1 - g) * 255

def patt(g):
    a = np.kron(inner(g), np.ones((4, 4))).astype(int)  # 16x16
    blocks = []
    for k in range(4):
        r = np.rot90(a, k)  # gegen den Uhrzeigersinn, wie der AR.js Marker-Trainer
        rows = []
        for _ch in range(3):
            for y in range(16):
                rows.append(' '.join(str(v).rjust(3) for v in r[y]))
        blocks.append('\n'.join(rows) + '\n')
    return '\n'.join(blocks)

def png(g, px=1024):
    # Gesamtmarker: schwarzer Rand 25 % je Seite (patternRatio 0.5)
    full = np.zeros((8, 8), dtype=np.uint8)
    full[2:6, 2:6] = inner(g)
    img = Image.fromarray(np.kron(full, np.ones((px // 8, px // 8), dtype=np.uint8)))
    # weiße Ruhezone
    q = px // 8
    canvas_img = Image.new('L', (px + 2 * q, px + 2 * q), 255)
    canvas_img.paste(img, (q, q))
    return img, canvas_img

os.makedirs(OUT, exist_ok=True)
for (mid, title, sub, col), g in zip(MARKERS, grids):
    open(f'{OUT}/marker-{mid}.patt', 'w').write(patt(g))
    img, padded = png(g)
    padded.save(f'{OUT}/marker-{mid}.png')

def draw_marker(c, g, x, y, size):
    """Zeichnet Marker (Außenkante size) mit linker unterer Ecke bei x,y."""
    cell = size / 8
    c.setFillColorRGB(0, 0, 0)
    c.rect(x, y, size, size, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.rect(x + 2 * cell, y + 2 * cell, 4 * cell, 4 * cell, stroke=0, fill=1)
    c.setFillColorRGB(0, 0, 0)
    for r in range(4):
        for col in range(4):
            if g[r][col]:
                c.rect(x + (2 + col) * cell, y + size - (3 + r) * cell, cell, cell, stroke=0, fill=1)

def ruler(c, x, y, length_cm):
    c.setStrokeColorRGB(0.2, 0.2, 0.2); c.setLineWidth(0.8)
    c.line(x, y, x + length_cm * cm, y)
    for i in range(length_cm + 1):
        c.line(x + i * cm, y, x + i * cm, y + (0.35 if i % 5 == 0 else 0.2) * cm)
    c.setFont('DV', 7); c.setFillColorRGB(0.2, 0.2, 0.2)
    c.drawString(x + length_cm * cm + 0.2 * cm, y, f'{length_cm} cm – reference length')

def big_pdf(path, size_cm):
    W, H = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f'AR Mini Golf Markers ({size_cm:g} cm)'); c.setAuthor('AR Mini Golf')
    size = size_cm * cm
    for (mid, title, sub, col), g in zip(MARKERS, grids):
        r, gg, b = [v / 255 for v in col]
        # Kopfzeile
        c.setFillColorRGB(r, gg, b); c.roundRect(1.5 * cm, H - 3.4 * cm, W - 3 * cm, 1.9 * cm, 0.4 * cm, stroke=0, fill=1)
        c.setFillColorRGB(0.07, 0.07, 0.1); c.setFont('DVB', 26)
        c.drawString(2.1 * cm, H - 2.65 * cm, f'Marker {mid} · {title}')
        c.setFont('DV', 12); c.drawString(2.1 * cm, H - 3.15 * cm, sub)
        c.setFont('DV', 9); c.drawRightString(W - 2.1 * cm, H - 2.65 * cm, 'AR Mini Golf')
        # Marker zentriert
        x = (W - size) / 2; y = (H - size) / 2 - 0.6 * cm
        draw_marker(c, g, x, y, size)
        # Ausrichtungshinweis für Wände
        c.setFillColorRGB(0.35, 0.35, 0.4); c.setFont('DV', 9)
        if mid in ('C', 'E'):
            c.setStrokeColorRGB(r, gg, b); c.setLineWidth(3)
            c.line(x, y + size + 0.5 * cm, x + size, y + size + 0.5 * cm)
            c.drawCentredString(W / 2, y + size + 0.75 * cm, 'The virtual wall runs parallel to this line')
        elif mid == 'A':
            c.drawCentredString(W / 2, y + size + 0.5 * cm, 'The ball starts in the center of this marker')
        elif mid == 'B':
            c.drawCentredString(W / 2, y + size + 0.5 * cm, 'The hole is in the center of this marker')
        else:
            c.drawCentredString(W / 2, y + size + 0.5 * cm, 'The obstacle stands in the center of this marker')
        ruler(c, 1.5 * cm, 1.4 * cm, 10)
        c.showPage()
    c.save()

def small_pdf(path, size_cm):
    W, H = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f'AR Mini Golf Table Markers ({size_cm:g} cm)')
    size = size_cm * cm
    c.setFont('DVB', 16); c.setFillColorRGB(0.07, 0.07, 0.1)
    c.drawString(1.5 * cm, H - 1.8 * cm, f'AR Mini Golf · Table markers ({size_cm:g} cm) – all 6 on one page')
    c.setFont('DV', 9); c.setFillColorRGB(0.3, 0.3, 0.35)
    c.drawString(1.5 * cm, H - 2.4 * cm, 'Cut along the dashed lines.')
    cellw = (W - 3 * cm) / 2; cellh = (H - 5 * cm) / 3
    for i, ((mid, title, sub, col), g) in enumerate(zip(MARKERS, grids)):
        cx = 1.5 * cm + (i % 2) * cellw; cy = H - 3 * cm - (i // 2 + 1) * cellh
        c.setStrokeColorRGB(0.75, 0.75, 0.78); c.setDash(3, 3); c.setLineWidth(0.5)
        c.rect(cx, cy, cellw, cellh); c.setDash()
        x = cx + (cellw - size) / 2; y = cy + 0.25 * cm
        draw_marker(c, g, x, y, size)
        r, gg, b = [v / 255 for v in col]
        c.setFillColorRGB(r, gg, b); c.circle(cx + 0.55 * cm, cy + cellh - 0.5 * cm, 0.18 * cm, stroke=0, fill=1)
        c.setFillColorRGB(0.07, 0.07, 0.1); c.setFont('DVB', 10)
        c.drawString(cx + 0.9 * cm, cy + cellh - 0.62 * cm, f'{mid} · {title}')
        c.setFont('DV', 8); c.drawString(cx + 0.9 * cm + c.stringWidth(f'{mid} · {title}', 'DVB', 10) + 0.3 * cm, cy + cellh - 0.62 * cm, sub)
    ruler(c, 1.5 * cm, 1.2 * cm, 10)
    c.showPage(); c.save()

big_pdf(f'{OUT}/AR-MiniGolf_Markers_A4_16cm.pdf', 16)
small_pdf(f'{OUT}/AR-MiniGolf_Markers_Table_7cm.pdf', 7)
print('ok')
