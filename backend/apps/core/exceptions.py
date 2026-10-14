from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    """Every error response carries a human-readable `error` string the UI can show as-is."""
    response = exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, NotAuthenticated):
        response.status_code = 401  # session auth has no WWW-Authenticate scheme, so DRF says 403; the SPA wants 401
    data = response.data
    if isinstance(data, dict) and "detail" in data and len(data) == 1:
        response.data = {"error": str(data["detail"])}
    elif isinstance(data, dict):
        first = next(iter(data.values()), "")
        msg = first[0] if isinstance(first, list) and first else first
        response.data = {"error": str(msg), "fields": data}
    elif isinstance(data, list):
        response.data = {"error": str(data[0]) if data else "Invalid request."}
    return response
