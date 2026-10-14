"""CSV downloads that open cleanly in Excel and Google Sheets."""
import csv
import io
import re

from django.http import HttpResponse
from django.utils import timezone

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def safe(value) -> str:
    """Stop spreadsheet apps from running a cell as a formula (CSV injection)."""
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M:%S") if hasattr(value, "tzinfo") else value.isoformat()
    s = str(value)
    if re.fullmatch(r"\+\d{1,15}", s):  # a phone number like +8801712345678 is harmless
        return s
    return "'" + s if s.startswith(FORMULA_START) else s


def csv_response(filename: str, header: list[str], rows) -> HttpResponse:
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM: Excel then reads UTF-8 (Bangla, emoji) correctly
    w = csv.writer(buf)
    w.writerow(header)
    for row in rows:
        w.writerow([safe(v) for v in row])
    resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp
