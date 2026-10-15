"""Phone number clean-up. Numbers are stored as international digits without "+", e.g. 8801712345678."""
import csv
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


NUMBERISH = re.compile(r"[\d\s+()-]*")
# Header words, lower-case. A column whose header contains a PHONE_WORD is searched for the number;
# the name comes from the best-matching name column. Bangla headers work too.
PHONE_WORDS = ("phone", "mobile", "number", "cell", "whatsapp", "tel", "msisdn", "ফোন", "মোবাইল", "নম্বর", "নাম্বার")
FULL_NAME_HEADERS = ("name", "full name", "display name", "contact name", "customer name", "client name", "নাম")
NOT_A_NAME = ("user", "group", "company", "organization", "organisation", "middle", "phonetic", "nick", "file", "label")


def _cells(line: str, delimiter: str | None) -> list[str]:
    if delimiter:
        row = next(csv.reader([line], delimiter=delimiter), [])
    else:
        row = re.split(r"[,;\t]", line)
    return [c.strip().strip('"').strip() for c in row]


def _columns(header: list[str]) -> tuple[list[int], list[int]] | None:
    """(phone column indexes, name column indexes) if this row is a header we understand, else None."""
    h = [c.lower().lstrip("﻿").strip() for c in header]
    phones = [i for i, c in enumerate(h) if any(w in c for w in PHONE_WORDS)]
    names = [i for i, c in enumerate(h) if c in FULL_NAME_HEADERS]
    if not names:
        first = [i for i, c in enumerate(h) if c in ("first name", "given name", "first")]
        last = [i for i, c in enumerate(h) if c in ("last name", "family name", "surname", "last")]
        names = first[:1] + last[:1]
    if not names:
        names = [i for i, c in enumerate(h)
                 if ("name" in c or "নাম" in c) and i not in phones and not any(w in c for w in NOT_A_NAME)][:1]
    return (phones, names) if phones or names else None


def parse_lines(text: str, default_country_code: str = "", info: dict | None = None):
    """Parse pasted text or CSV. Yields (line_no, phone_or_None, name, raw_line).

    With a header row (e.g. "Name,Phone"), only the name and phone columns are read and every other
    column is ignored. Without one, each line holds a number and optionally a name, in either order,
    separated by comma, semicolon or tab. `info`, if given, receives the header names that were used.
    """
    lines = [(i, line.strip()) for i, line in enumerate(str(text or "").splitlines(), start=1)]
    lines = [(i, raw) for i, raw in lines if raw]
    phone_cols = name_cols = None
    delimiter = None
    if lines:
        first = lines[0][1].lstrip("﻿")
        delimiter = max(",;\t", key=first.count) if any(d in first for d in ",;\t") else ","
        header = _cells(first, delimiter)
        cols = None if any(normalize(c, default_country_code) for c in header) else _columns(header)
        if cols:
            phone_cols, name_cols = cols
            lines = lines[1:]
            if info is not None:
                info["phone_column"] = ", ".join(header[i] for i in phone_cols) or None
                info["name_column"] = " + ".join(header[i] for i in name_cols) or None
        else:
            delimiter = None  # free-form text: each line may use a different separator

    def free_form(raw):
        cells = _cells(raw, None)
        phone = next((p for c in cells if (p := normalize(c, default_country_code))), None)
        return phone, next((c for c in cells if c and not NUMBERISH.fullmatch(c)), "")

    for i, raw in lines:
        if delimiter is None:
            phone, name = free_form(raw)
        else:
            cells = _cells(raw, delimiter)
            pick = lambda idx: [cells[j] for j in idx if j < len(cells)]  # noqa: E731
            phone = next((p for c in pick(phone_cols or range(len(cells))) if (p := normalize(c, default_country_code))), None)
            if phone is None:
                phone, name = free_form(raw)  # a line that doesn't follow the header's layout
            elif name_cols:
                name = " ".join(c for c in pick(name_cols) if c)
            else:
                name = next((c for c in cells if c and not NUMBERISH.fullmatch(c)), "")
        yield i, phone, name[:120], raw
