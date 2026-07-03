"""QR-коды и печатные карточки/этикетки катушек.

Поддерживает разные размеры этикеток (пресеты) и настраиваемый набор полей.
QR ведёт на приватную страницу {frontend}/s/{token}.
"""
import base64
import io

import qrcode
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FilamentProfile, Location, Spool

# Helvetica и встроенная в reportlab Vera не содержат кириллицу.
# DejaVuSans (пакет fonts-dejavu-core, ставится в Dockerfile) — содержит.
FONT = "DejaVu"
FONT_BOLD = "DejaVu-Bold"
_DEJAVU_DIR = "/usr/share/fonts/truetype/dejavu"
try:
    pdfmetrics.registerFont(TTFont(FONT, f"{_DEJAVU_DIR}/DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, f"{_DEJAVU_DIR}/DejaVuSans-Bold.ttf"))
except Exception:  # pragma: no cover - запасной вариант без кириллицы
    FONT, FONT_BOLD = "Helvetica", "Helvetica-Bold"


# ---------- QR ----------
def qr_url(token: str) -> str:
    """Абсолютная ссылка для QR-кода катушки.

    Приоритет: явный FRONTEND_BASE_URL из настроек → origin текущего запроса
    (адрес, с которого открыт интерфейс) → localhost как последний резерв.
    """
    from app.core.request_context import get_frontend_origin

    base = (
        settings.frontend_base_url.strip()
        or get_frontend_origin()
        or "http://localhost:5173"
    )
    return f"{base.rstrip('/')}/s/{token}"


def qr_png_bytes(token: str) -> bytes:
    qr = qrcode.QRCode(border=1, box_size=10)
    qr.add_data(qr_url(token))
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buf, format="PNG")
    return buf.getvalue()


def qr_png_base64(token: str) -> str:
    return "data:image/png;base64," + base64.b64encode(qr_png_bytes(token)).decode()


# ---------- Данные карточки ----------
def _fmt_temp(lo, hi):
    if lo and hi and lo != hi:
        return f"{lo}-{hi}°C"
    v = lo or hi
    return f"{v}°C" if v else None


def _num(v):
    return float(v) if v is not None else None


def build_card_data(db: Session, spool: Spool) -> dict:
    p = db.get(FilamentProfile, spool.filament_profile_id) if spool.filament_profile_id else None
    loc = db.get(Location, spool.location_id) if spool.location_id else None
    sp = spool.specs or {}
    empty = _num(spool.empty_spool_weight_g)
    remaining = float(spool.current_weight_g)

    def spec_or_profile(spec_key, profile_attr):
        v = sp.get(spec_key)
        if v is not None:
            return _num(v)
        return _num(getattr(p, profile_attr)) if p else None

    # поля катушки имеют приоритет над профилем
    nozzle = (
        f"{spool.hotend_temp}°C"
        if spool.hotend_temp
        else _fmt_temp(p.nozzle_temp_min if p else None, p.nozzle_temp_max if p else None)
    )
    bed = (
        f"{spool.bed_temp}°C"
        if spool.bed_temp
        else _fmt_temp(p.bed_temp_min if p else None, p.bed_temp_max if p else None)
    )
    return {
        "spool_id": str(spool.id),
        "label": spool.label or "Без метки",
        "brand": spool.manufacturer or (p.brand if p else None),
        "name": (p.name if p else None) or spool.label,
        "material": spool.material or (p.material if p else None),
        "color_name": spool.color_name or (p.color_name if p else None),
        "color_hex": spool.color_hex or (p.color_hex if p else None),
        "nozzle_temp": nozzle,
        "bed_temp": bed,
        "pressure_advance": spec_or_profile("pressure_advance", "pressure_advance"),
        "flow_ratio": spec_or_profile("flow_ratio", "flow_ratio"),
        "max_volumetric_speed": spec_or_profile("max_volumetric_speed", "max_volumetric_speed"),
        "print_speed_mm_s": p.print_speed_mm_s if p else None,
        "fan_percent": spool.fan_speed if spool.fan_speed is not None else (p.fan_percent if p else None),
        "diameter_mm": _num(spool.diameter_mm) if spool.diameter_mm else (_num(p.diameter_mm) if p else None),
        "density_g_cm3": spec_or_profile("density", "density_g_cm3"),
        "empty_spool_weight_g": empty,
        "total_weight_g": (empty + remaining) if empty is not None else None,
        "remaining_g": remaining,
        "location_name": loc.name if loc else None,
        "opened_date": spool.opened_date.isoformat() if spool.opened_date else None,
        "qr_token": spool.qr_token,
        "qr_png_base64": qr_png_base64(spool.qr_token),
    }


# ---------- Каталог полей (что можно выводить на этикетке) ----------
def _g(key):
    return lambda d: d.get(key)


def _flow_info(d):
    mv = d.get("max_volumetric_speed")
    fr = d.get("flow_ratio")
    parts = []
    if mv:
        parts.append(f"{mv:g}mm³/s")
    if fr:
        parts.append(f"{fr:g}")
    return ", ".join(parts) or None


# key -> (подпись, функция-геттер)
FIELD_CATALOG: dict[str, tuple[str, callable]] = {
    "nozzle_temp": ("Nozzle", _g("nozzle_temp")),
    "bed_temp": ("Bed Temp", _g("bed_temp")),
    "pressure_advance": ("Pressure Adv", lambda d: f"{d['pressure_advance']:g}" if d.get("pressure_advance") is not None else None),
    "flow_ratio": ("Flow Ratio", lambda d: f"{d['flow_ratio']:g}" if d.get("flow_ratio") is not None else None),
    "max_volumetric_speed": ("Max Vol Speed", lambda d: f"{d['max_volumetric_speed']:g} mm³/s" if d.get("max_volumetric_speed") else None),
    "flow_info": ("Flow Info", _flow_info),
    "print_speed": ("Speed", lambda d: f"{d['print_speed_mm_s']} mm/s" if d.get("print_speed_mm_s") else None),
    "diameter": ("Диаметр", lambda d: f"{d['diameter_mm']:g} мм" if d.get("diameter_mm") else None),
    "density": ("Плотность", lambda d: f"{d['density_g_cm3']:g} г/см³" if d.get("density_g_cm3") else None),
    "empty_spool_weight": ("Пустая катушка", lambda d: f"{d['empty_spool_weight_g']:.0f} г" if d.get("empty_spool_weight_g") is not None else None),
    "remaining": ("Остаток", lambda d: f"{d['remaining_g']:.0f} г"),
    "location": ("Хранение", _g("location_name")),
    "opened_date": ("Открыта", _g("opened_date")),
    "material": ("Материал", _g("material")),
    "none": ("", lambda d: None),
}

DEFAULT_FIELDS = ["nozzle_temp", "bed_temp", "pressure_advance", "flow_info"]

# Размеры этикеток (ширина, высота) в мм — как на скриншоте
SIZE_PRESETS: dict[str, tuple[float, float]] = {
    "classic": (40, 30),
    "expanded": (50, 30),
    "compact": (40, 25),
    "slim": (40, 12),
    "vertical": (30, 40),
    "vertical_compact": (25, 40),
}


def _field_lines(data: dict, fields: list[str]) -> list[tuple[str, str]]:
    out = []
    for key in fields:
        label, getter = FIELD_CATALOG.get(key, ("", lambda d: None))
        val = getter(data)
        if val:
            out.append((label, str(val)))
    return out


def _clip(text, font, size, max_w):
    if stringWidth(text, font, size) <= max_w:
        return text
    while text and stringWidth(text + "…", font, size) > max_w:
        text = text[:-1]
    return text + "…"


def _fit_font(text, font, max_size, min_size, max_w):
    """Подбирает размер шрифта так, чтобы текст влез в ширину (auto-fit)."""
    size = max_size
    while size > min_size and stringWidth(text, font, size) > max_w:
        size -= 0.5
    return size


def _draw_card(c, x, y, w, h, data, qr_reader, fields):
    """Рисует карточку в (x,y). Раскладка выбирается по геометрии:
    низкая лента — slim, портрет — vertical, иначе — горизонтальная."""
    if h <= 16 * mm:
        return _draw_slim(c, x, y, w, h, data, qr_reader, fields)
    if h > w:
        return _draw_vertical(c, x, y, w, h, data, qr_reader, fields)
    return _draw_horizontal(c, x, y, w, h, data, qr_reader, fields)


def _draw_slim(c, x, y, w, h, data, qr_reader, fields):
    """Лента 40×12: QR во всю высоту справа, слева три плотные строки."""
    pad = 1.1 * mm
    qr_size = h - 2 * pad
    qr_x = x + w - qr_size - pad
    c.drawImage(qr_reader, qr_x, y + pad, qr_size, qr_size)

    text_x = x + pad
    text_w = qr_x - text_x - pad
    ty = y + h - pad

    # 1) производитель + материал на плашке в одну строку;
    #    ширина делится динамически: бренд берёт сколько нужно, материал — остальное
    brand = data.get("brand") or data.get("name") or data["label"]
    material = data.get("material")
    b_size = _fit_font(brand, FONT_BOLD, 7, 5, text_w * (0.6 if material else 1.0))
    brand_txt = _clip(brand, FONT_BOLD, b_size, text_w * (0.6 if material else 1.0))
    brand_w = stringWidth(brand_txt, FONT_BOLD, b_size)
    ty -= b_size
    c.setFont(FONT_BOLD, b_size)
    c.drawString(text_x, ty, brand_txt)
    if material:
        avail = text_w - brand_w - 4
        m_size = _fit_font(material, FONT_BOLD, b_size, 4.5, avail - 3)
        mat = _clip(material, FONT_BOLD, m_size, avail - 3)
        tw = stringWidth(mat, FONT_BOLD, m_size)
        mx = text_x + text_w - tw - 2
        c.setFillGray(0)
        c.rect(mx - 1.5, ty - m_size * 0.28, tw + 3, m_size * 1.32, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont(FONT_BOLD, m_size)
        c.drawString(mx, ty, mat)
        c.setFillGray(0)

    # 2) код цвета
    hexv = data.get("color_hex")
    if hexv:
        h_size = 5.5
        ty -= h_size + 1.6
        c.setFont(FONT, h_size)
        c.drawString(text_x, ty, _clip(hexv, FONT, h_size, text_w))

    # 3) поля одной компактной строкой: «Nozzle 210°C · Bed 60°C»
    lines = _field_lines(data, fields)
    if lines:
        compact = " · ".join(f"{lbl} {val}" for lbl, val in lines)
        f_size = _fit_font(compact, FONT, 6, 4, text_w)
        ty -= f_size + 1.8
        c.setFont(FONT, f_size)
        c.drawString(text_x, ty, _clip(compact, FONT, f_size, text_w))


def _draw_vertical(c, x, y, w, h, data, qr_reader, fields):
    """Портрет (30×40, 25×40): крупный QR сверху по центру, заголовок под ним,
    строки полей во всю ширину до низа."""
    pad = 1.4 * mm
    full_w = w - 2 * pad
    text_x = x + pad

    # QR — сверху по центру, крупный
    qr_size = min(full_w * 0.72, h * 0.40)
    qr_x = x + (w - qr_size) / 2
    qr_y = y + h - qr_size - pad
    c.drawImage(qr_reader, qr_x, qr_y, qr_size, qr_size)
    ty = qr_y - 1.5

    def centered(text, font, size):
        tw = stringWidth(text, font, size)
        c.drawString(x + (w - tw) / 2, ty, text)

    # производитель
    brand = data.get("brand") or data.get("name") or data["label"]
    b_size = _fit_font(brand, FONT_BOLD, 8, 5, full_w)
    ty -= b_size
    c.setFont(FONT_BOLD, b_size)
    centered(_clip(brand, FONT_BOLD, b_size, full_w), FONT_BOLD, b_size)

    # материал — белым на чёрной плашке, по центру
    material = data.get("material")
    if material:
        m_size = min(8, b_size)
        mat = _clip(material, FONT_BOLD, m_size, full_w - 2)
        tw = stringWidth(mat, FONT_BOLD, m_size)
        ty -= m_size + 2.6
        mx = x + (w - tw) / 2
        c.setFillGray(0)
        c.rect(mx - 2, ty - m_size * 0.28, tw + 4, m_size * 1.32, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont(FONT_BOLD, m_size)
        c.drawString(mx, ty, mat)
        c.setFillGray(0)

    # код цвета
    hexv = data.get("color_hex")
    if hexv:
        h_size = 5.5
        ty -= h_size + 2.2
        c.setFont(FONT, h_size)
        centered(hexv, FONT, h_size)

    ty -= 1.5

    # строки полей на всю ширину до нижнего края
    lines = _field_lines(data, fields)
    line_size = 5.6
    line_h = line_size + 1.7
    label_w = min(
        full_w * 0.55,
        max([stringWidth(f"{lbl}:", FONT, line_size) for lbl, _ in lines], default=0) + 2,
    )
    val_w = full_w - label_w
    bottom = y + pad
    for label, value in lines:
        if ty - line_h < bottom:
            break
        ty -= line_h
        c.setFont(FONT, line_size)
        c.setFillGray(0.4)
        c.drawString(text_x, ty, _clip(f"{label}:", FONT, line_size, label_w))
        v_size = line_size
        while v_size > 4 and stringWidth(value, FONT, v_size) > val_w:
            v_size -= 0.25
        c.setFont(FONT, v_size)
        c.setFillGray(0)
        c.drawString(text_x + label_w, ty, value)


def _draw_horizontal(c, x, y, w, h, data, qr_reader, fields):
    """Классическая раскладка: QR в правом верхнем углу, заголовок слева,
    строки полей на всю ширину (как на образце Anycubic)."""
    pad = max(1.3 * mm, w * 0.035)

    qr_size = min(h * 0.44, w * 0.32)
    qr_x = x + w - qr_size - pad
    qr_y = y + h - qr_size - pad
    c.drawImage(qr_reader, qr_x, qr_y, qr_size, qr_size)

    text_x = x + pad
    top_w = w - qr_size - 2 * pad  # ширина под заголовок (слева от QR)
    full_w = w - 2 * pad           # полная ширина для строк полей

    # Шапка: 3 строки — производитель, материал, код цвета (без свотча).
    brand = data.get("brand") or data.get("name") or data["label"]
    material = data.get("material")
    hexv = data.get("color_hex")
    ty = y + h - pad

    # 1) Производитель (шрифт поменьше)
    b_size = _fit_font(brand, FONT_BOLD, min(9, h * 0.17), 5.5, top_w)
    c.setFont(FONT_BOLD, b_size)
    ty -= b_size
    c.drawString(text_x, ty, _clip(brand, FONT_BOLD, b_size, top_w))

    # 2) Материал — белый текст на чёрной плашке
    if material:
        m_size = max(5, min(9, h * 0.18))
        mat = _clip(material, FONT_BOLD, m_size, top_w - 2)
        tw = stringWidth(mat, FONT_BOLD, m_size)
        ty -= m_size + 3
        c.setFillGray(0)
        c.rect(text_x - 1, ty - m_size * 0.28, tw + 3, m_size * 1.32, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont(FONT_BOLD, m_size)
        c.drawString(text_x + 0.5, ty, mat)
        c.setFillGray(0)

    # 3) Код цвета (обычный чёрный)
    if hexv:
        h_size = max(4.5, min(7, h * 0.14))
        c.setFont(FONT, h_size)
        ty -= h_size + 2.5
        c.drawString(text_x, ty, _clip(hexv, FONT, h_size, top_w))

    ty = min(ty, qr_y) - 1.5

    # Строки полей на всю ширину; колонка подписей = по самой длинной подписи
    lines = _field_lines(data, fields)
    line_size = max(4.5, min(7.5, h * 0.105))
    line_h = line_size + 1.9
    label_w = min(
        full_w * 0.5,
        max([stringWidth(f"{lbl}:", FONT, line_size) for lbl, _ in lines], default=0) + 2,
    )
    val_w = full_w - label_w
    bottom = y + pad
    for label, value in lines:
        if ty - line_h < bottom:
            break
        ty -= line_h
        c.setFont(FONT, line_size)
        c.setFillGray(0.4)
        c.drawString(text_x, ty, _clip(f"{label}:", FONT, line_size, label_w))
        # значение: уменьшаем шрифт, чтобы влезло целиком (не режем цифры)
        v_size = line_size
        while v_size > 4 and stringWidth(value, FONT, v_size) > val_w:
            v_size -= 0.25
        c.setFont(FONT, v_size)
        c.setFillGray(0)
        c.drawString(text_x + label_w, ty, value)


def _resolve(size: str, fields: list[str] | None):
    w_mm, h_mm = SIZE_PRESETS.get(size, SIZE_PRESETS["classic"])
    flds = [f for f in (fields or DEFAULT_FIELDS) if f in FIELD_CATALOG and f != "none"]
    return w_mm * mm, h_mm * mm, (flds or DEFAULT_FIELDS)


def single_label_pdf(db: Session, spool: Spool, size: str = "classic", fields=None) -> bytes:
    w, h, flds = _resolve(size, fields)
    data = build_card_data(db, spool)
    qr_reader = ImageReader(io.BytesIO(qr_png_bytes(spool.qr_token)))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    _draw_card(c, 0, 0, w, h, data, qr_reader, flds)
    c.showPage()
    c.save()
    return buf.getvalue()


def single_label_png(db: Session, spool: Spool, size: str = "classic", fields=None, scale: int = 4) -> bytes:
    """Растрирует одну этикетку в PNG (для предпросмотра без PDF-вьюера браузера)."""
    import fitz  # pymupdf

    pdf = single_label_pdf(db, spool, size=size, fields=fields)
    doc = fitz.open(stream=pdf, filetype="pdf")
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return pix.tobytes("png")


def a4_labels_pdf(db: Session, spools: list[Spool], size: str = "classic", fields=None) -> bytes:
    from reportlab.lib.pagesizes import A4

    page_w, page_h = A4
    cw, ch, flds = _resolve(size, fields)
    margin = 8 * mm
    gap = 4 * mm
    cols = max(1, int((page_w - 2 * margin + gap) // (cw + gap)))
    rows = max(1, int((page_h - 2 * margin + gap) // (ch + gap)))
    per_page = cols * rows
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i, spool in enumerate(spools):
        if i > 0 and i % per_page == 0:
            c.showPage()
        pos = i % per_page
        col, row = pos % cols, pos // cols
        x = margin + col * (cw + gap)
        y = page_h - margin - (row + 1) * ch - row * gap
        data = build_card_data(db, spool)
        qr_reader = ImageReader(io.BytesIO(qr_png_bytes(spool.qr_token)))
        _draw_card(c, x, y, cw, ch, data, qr_reader, flds)
    c.showPage()
    c.save()
    return buf.getvalue()
