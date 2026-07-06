#!/usr/bin/env python3
"""Isometric 3D-printer illustration generator.

Styled after the reference Anycubic Kobra S1 Combo SVG: dark-navy body,
soft 3-face isometric shading, orange hotend accent, optional ACE-Pro MMU box.
Emits one SVG per printer preset (slug), tinted by brand accent color.
"""
import math

COS = math.cos(math.radians(30))
SIN = math.sin(math.radians(30))

# ---- palette (sampled from reference) ----------------------------------
TOP     = "#4B4B63"
LEFT    = "#33334A"
RIGHT   = "#1C1C2E"
EDGE    = "#0B091D"
GLASS   = "#5C5D78"
GLASSHI = "#9092AC"
HI      = "#CDCAD9"
SCREEN  = "#0E1630"
ACCENT  = "#ED9469"
METAL   = "#63657E"
METAL_D = "#3F3F56"

BRAND_ACCENT = {
    "anycubic": "#12b886", "bambu": "#00ae42", "bambu lab": "#00ae42",
    "prusa": "#fa6831", "prusa research": "#fa6831", "creality": "#0aa1e0",
    "elegoo": "#e8412b", "voron": "#e4002b", "qidi": "#f5a623",
    "flashforge": "#f5a623", "artillery": "#e6a817", "biqu": "#00b3a4",
    "comgrow": "#3aa0ff", "kingroon": "#ff7a1a", "lulzbot": "#7ac142",
    "sovol": "#e2481f", "flsun": "#e94f37",
}


def iso(x, y, z):
    return (x - y) * COS, (x + y) * SIN - z


def pts(coords):
    return " ".join(f"{X:.2f},{Y:.2f}" for X, Y in coords)


def poly(coords, fill, stroke=EDGE, sw=2.0, op=None):
    o = f' fill-opacity="{op}"' if op is not None else ""
    st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ""
    return f'<polygon points="{pts(coords)}" fill="{fill}"{o}{st}/>'


def cuboid(x, y, z, w, d, h, top=TOP, left=LEFT, right=RIGHT, edge=EDGE, ew=2.0):
    """3-face iso cuboid. 'left' = long face at const-x (x+w); 'right' = face at const-y (y+d)."""
    P = iso
    top_f = [P(x, y, z+h), P(x+w, y, z+h), P(x+w, y+d, z+h), P(x, y+d, z+h)]
    left_f = [P(x+w, y, z), P(x+w, y+d, z), P(x+w, y+d, z+h), P(x+w, y, z+h)]
    right_f = [P(x, y+d, z), P(x+w, y+d, z), P(x+w, y+d, z+h), P(x, y+d, z+h)]
    s = poly(right_f, right, edge, ew)
    s += poly(left_f, left, edge, ew)
    s += poly(top_f, top, edge, ew)
    return s


def post(x, y, z, w, d, h, **k):
    return cuboid(x, y, z, w, d, h, top=METAL, left=METAL_D, right=RIGHT, ew=1.4)


# ------------------------------------------------------------------ archetypes
def enclosed(accent):
    P = iso
    g = ""
    W = D = 130; H = 128
    g += cuboid(0, 0, 0, W, D, H)
    # glass door on long left face (const-x = W)
    g += poly([P(W+.2, 18, 16), P(W+.2, D-14, 16), P(W+.2, D-14, H-30), P(W+.2, 18, H-30)],
              GLASS, GLASSHI, 2, op=0.72)
    g += poly([P(W+.4, 26, H-40), P(W+.4, 50, H-40), P(W+.4, 38, 42), P(W+.4, 26, 42)],
              "#FFFFFF", None, op=0.10)
    # hotend accent inside
    g += poly([P(W-1, 58, 66), P(W-1, 80, 66), P(W-1, 80, 60), P(W-1, 58, 60)], accent, None)
    # brand LED strip along bottom front edge
    g += poly([P(W+.3, 16, 12), P(W+.3, D-12, 12), P(W+.3, D-12, 8), P(W+.3, 16, 8)], accent, None, op=0.85)
    # top screen
    g += poly([P(20, 22, H), P(64, 22, H), P(64, 46, H), P(20, 46, H)], SCREEN, HI, 1.5)
    return g


def bedslinger(accent):
    P = iso
    g = ""
    # base / electronics
    g += cuboid(0, 6, 0, 132, 104, 24)
    # bed plate
    g += poly([P(14, 20, 30), P(120, 20, 30), P(120, 96, 30), P(14, 96, 30)], METAL, EDGE, 1.6)
    g += poly([P(20, 26, 31), P(114, 26, 31), P(114, 90, 31), P(20, 90, 31)], METAL_D, None, op=0.9)
    # gantry portal at the back (low x+y). posts at back-left & back-right
    g += post(8, 8, 24, 12, 12, 132)     # back-left upright
    g += post(112, 8, 24, 12, 12, 132)   # back-right upright
    # top beam spanning the two posts along x, at the back
    g += post(8, 8, 150, 116, 12, 12)
    # X carriage on the beam
    g += cuboid(52, 4, 120, 26, 20, 18, top=METAL, left=METAL_D, right=RIGHT, ew=1.4)
    # nozzle
    g += poly([P(62, 14, 120), P(68, 14, 120), P(65, 14, 108)], accent, None)
    return g


def delta(accent, enclosed_delta=False):
    P = iso
    g = ""
    # round-ish base (octagon prism approximated by cuboid + chamfer look)
    g += cuboid(4, 4, 0, 116, 116, 26)
    # three vertical towers (triangle: back-left, back-right, front-center)
    towers = [(14, 14), (108, 14), (60, 104)]
    for (tx, ty) in towers:
        g += post(tx-6, ty-6, 26, 12, 12, 150)
    # top cap ring
    g += cuboid(8, 8, 176, 108, 108, 14, top=METAL, left=METAL_D, right=RIGHT, ew=1.6)
    # effector + nozzle hanging center
    g += cuboid(50, 50, 84, 24, 24, 12, top=METAL, left=METAL_D, right=RIGHT, ew=1.4)
    g += poly([P(59, 62, 84), P(65, 62, 84), P(62, 62, 72)], accent, None)
    if enclosed_delta:
        # faint glass cylinder hint around
        g += poly([P(4, 4, 26), P(120, 4, 26), P(120, 4, 176), P(4, 4, 176)], GLASS, GLASSHI, 1.5, op=0.14)
    return g


def ace_box(accent):
    """ACE-Pro style MMU box beside the printer (right side, +x/+y)."""
    P = iso
    bx, by, bz = 156, 4, 0
    W, D, H = 66, 128, 64
    g = cuboid(bx, by, bz, W, D, H)
    # 4 spool bays on the long left face (const-x = bx+W), spaced along y
    face_x = bx + W + 0.3
    for i in range(4):
        y1 = by + 10 + i * (D - 20) / 4
        y2 = by + 10 + (i + 1) * (D - 20) / 4 - 5
        g += poly([P(face_x, y1, 10), P(face_x, y2, 10), P(face_x, y2, H-12), P(face_x, y1, H-12)],
                  EDGE, None, op=0.55)
        g += poly([P(face_x, y1, 12), P(face_x, y1+3, 12), P(face_x, y1+3, H-14), P(face_x, y1, H-14)],
                  accent, None, op=0.5)
    # top glass lid
    g += poly([P(bx+8, by+10, H), P(bx+W-8, by+10, H), P(bx+W-8, by+D-10, H), P(bx+8, by+D-10, H)],
              GLASS, GLASSHI, 1.6, op=0.6)
    return g


def build(form, brand, mmu=False, enclosed_delta=False):
    accent = BRAND_ACCENT.get((brand or "").strip().lower(), "#8f7bff")
    if form == "enclosed":
        body = enclosed(accent)
    elif form == "delta":
        body = delta(accent, enclosed_delta)
    else:
        body = bedslinger(accent)
    inner = body + (ace_box(accent) if mmu else "")
    vb = "-250 -190 480 380" if not mmu else "-250 -210 560 420"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
            f'width="1024" height="1024">{inner}</svg>')


def slug(brand, model):
    s = f"{brand or ''} {model or ''}".lower().replace("/", " ").replace("+", "plus")
    return "-".join(s.split())


# (brand, model, has_chamber, has_mmu) — mirror of printer_presets.PRESETS
PRESETS = [
    ("Anycubic", "Kobra 2 Pro", 0, 0), ("Anycubic", "Kobra 3", 0, 0),
    ("Anycubic", "Kobra 3 Combo", 0, 1), ("Anycubic", "Kobra 3 V2", 0, 0),
    ("Anycubic", "Kobra 3 V2 Combo", 0, 1), ("Anycubic", "Kobra 3 Max", 0, 0),
    ("Anycubic", "Kobra 3 Max Combo", 0, 1), ("Anycubic", "Kobra S1", 1, 0),
    ("Anycubic", "Kobra S1 Combo", 1, 1), ("Anycubic", "Kobra S1 Max", 1, 0),
    ("Anycubic", "Kobra S1 Max Combo", 1, 1),
    ("Artillery", "Sidewinder X4 Pro", 0, 0), ("Artillery", "Sidewinder X4 Plus", 0, 0),
    ("BIQU", "Hurakan", 0, 0), ("Comgrow", "T500", 0, 0),
    ("Creality", "K1", 1, 0), ("Creality", "K1C", 1, 0), ("Creality", "K1 Max", 1, 0),
    ("Creality", "K2 Plus", 1, 0), ("Creality", "Ender-3 V3 KE", 0, 0),
    ("Creality", "Ender-3 V3 Plus", 0, 0), ("Creality", "CR-10 SE", 0, 0),
    ("ELEGOO", "Neptune 4 Plus", 0, 0), ("ELEGOO", "Neptune 4 Max", 0, 0),
    ("FLSUN", "V400", 0, 0), ("FLSUN", "V400 Max", 0, 0), ("FLSUN", "S1", 1, 0),
    ("FLSUN", "S1 Pro", 1, 0), ("FLSUN", "T1", 0, 0), ("FLSUN", "T1 Pro", 0, 0),
    ("FLSUN", "T1 Max", 0, 0),
    ("Flashforge", "Adventurer 5M", 0, 0), ("Flashforge", "Adventurer 5M Pro", 1, 0),
    ("Kingroon", "KP3S Pro V2", 0, 0), ("Kingroon", "KLP1", 1, 0),
    ("LulzBot", "Mini 3", 0, 0), ("Prusa", "Pro HT90", 1, 0),
    ("QIDI", "Q1 Pro", 1, 0), ("QIDI", "X-Smart 3", 1, 0), ("QIDI", "X-Plus 3", 1, 0),
    ("QIDI", "X-Max 3", 1, 0), ("QIDI", "Plus4", 1, 0), ("QIDI", "Max4", 1, 0),
    ("Sovol", "SV07", 0, 0), ("Sovol", "SV07 Plus", 0, 0), ("Sovol", "SV08", 0, 0),
    ("Sovol", "SV08 Max", 0, 0), ("Sovol", "SV06 ACE", 0, 0), ("Sovol", "SV06 Plus ACE", 0, 0),
]

DELTA_BRANDS = {"flsun"}
DELTA_MODELS = {("prusa", "pro ht90")}


def classify(brand, model, chamber, mmu):
    b = (brand or "").lower(); m = (model or "").lower()
    is_delta = b in DELTA_BRANDS or (b, m) in DELTA_MODELS
    if is_delta:
        return "delta", bool(chamber)
    return ("enclosed" if chamber else "bedslinger"), False


if __name__ == "__main__":
    import os, sys
    default = os.path.join(os.path.dirname(__file__), "..", "public", "icons", "printers")
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(default)
    KEEP = {"anycubic-kobra-s1-combo"}  # user-provided art — do not overwrite
    n = 0
    for brand, model, chamber, mmu in PRESETS:
        sl = slug(brand, model)
        if sl in KEEP:
            continue
        form, enc_delta = classify(brand, model, chamber, mmu)
        svg = build(form, brand, mmu=bool(mmu), enclosed_delta=enc_delta)
        open(f"{outdir}/{sl}.svg", "w").write(svg)
        n += 1
    print(f"wrote {n} svgs to {outdir}")
