"""Phone number clean-up. Numbers are stored as international digits without "+", e.g. 8801712345678."""
import re

MIN_DIGITS, MAX_DIGITS = 8, 15


def normalize(raw, default_country_code: str = "") -> str | None:
    """Return international digits, or None if it can't be a phone number.

    "+880 1712-345678", "00880…", "8801712345678" -> "8801712345678"
    "01712345678" with default_country_code "880"  -> "8801712345678" (local number, leading 0 dropped)
    """
    s = re.sub(r"[^\d+]", "", str(raw or ""))
    if s.startswith("+"):
        digits = s[1:]
    elif s.startswith("00"):
        digits = s[2:]
    elif s.startswith("0"):
        if not default_country_code:
            return None  # a local number, and we don't know which country it belongs to
        digits = default_country_code + s[1:]
    else:
        digits = s
    digits = re.sub(r"\D", "", digits)
    return digits if MIN_DIGITS <= len(digits) <= MAX_DIGITS else None


def jid(phone: str) -> str:
    return f"{phone}@s.whatsapp.net"


def phone_from_jid(j: str) -> str:
    return str(j).split("@")[0].split(":")[0]


def parse_lines(text: str, default_country_code: str = ""):
    """Parse pasted text or CSV. Each line holds a number and optionally a name, in either order,
    separated by comma, semicolon or tab. Yields (line_no, phone_or_None, name, raw_line)."""
    for i, line in enumerate(str(text or "").splitlines(), start=1):
        raw = line.strip()
        if not raw:
            continue
        cells = [c.strip().strip('"').strip() for c in re.split(r"[,;\t]", raw)]
        phone, name_parts = None, []
        for c in cells:
            if phone is None and (p := normalize(c, default_country_code)):
                phone = p
            elif c and not re.fullmatch(r"[\d\s+()-]*", c):
                name_parts.append(c)
        yield i, phone, " ".join(name_parts)[:120], raw
