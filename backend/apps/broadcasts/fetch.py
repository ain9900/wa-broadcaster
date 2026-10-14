"""Download a file from a link the user pasted, safely.

The server fetches the URL itself, so a link could be abused to reach machines that are only visible
from inside the server (SSRF): 127.0.0.1, the Docker network, cloud metadata at 169.254.169.254.
Every hop (including redirects) must resolve only to public internet addresses.
"""
import ipaddress
import mimetypes
import os
import socket
from dataclasses import dataclass
from urllib.parse import unquote, urljoin, urlparse

import requests
from django.conf import settings

ALLOWED_PORTS = {80, 443, 8080, 8443}
MAX_REDIRECTS = 4
TIMEOUT = (5, 30)  # connect, read


class FetchError(Exception):
    """Message is safe to show to the user."""


@dataclass
class Fetched:
    data: bytes
    mime_type: str
    filename: str
    url: str


def check_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise FetchError("Use a link that starts with http:// or https://.")
    if u.username or u.password:
        raise FetchError("Links with a username or password aren't allowed.")
    port = u.port or (443 if u.scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise FetchError("That link uses an unusual port.")
    try:
        infos = socket.getaddrinfo(u.hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise FetchError(f"Couldn't find the website {u.hostname}.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global:
            raise FetchError("That link points to a private or local address, which isn't allowed.")


def fetch(url: str) -> Fetched:
    url = url.strip()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    for _ in range(MAX_REDIRECTS + 1):
        check_url(url)
        try:
            r = requests.get(url, stream=True, timeout=TIMEOUT, allow_redirects=False,
                             headers={"User-Agent": "WA-Broadcaster/2.0 (+media fetch)"})
        except requests.RequestException:
            raise FetchError("Couldn't download that link. Check that it opens in your browser.")
        if r.is_redirect or r.is_permanent_redirect:
            url = urljoin(url, r.headers.get("Location", ""))
            r.close()
            continue
        break
    else:
        raise FetchError("That link redirects too many times.")

    with r:
        if r.status_code != 200:
            raise FetchError(f"The link answered with an error (HTTP {r.status_code}).")
        if int(r.headers.get("Content-Length") or 0) > max_bytes:
            raise FetchError(f"That file is larger than {settings.MAX_UPLOAD_MB} MB.")
        buf = bytearray()
        for chunk in r.iter_content(64 * 1024):
            buf += chunk
            if len(buf) > max_bytes:
                raise FetchError(f"That file is larger than {settings.MAX_UPLOAD_MB} MB.")
        if not buf:
            raise FetchError("That link returned an empty file.")
        mime = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()

    path_name = unquote(os.path.basename(urlparse(url).path)) or "file"
    if not mime or mime == "application/octet-stream":
        mime = mimetypes.guess_type(path_name)[0] or "application/octet-stream"
    if mime == "text/html":
        raise FetchError("That link is a web page, not a file. Use the direct link to the image (right-click it → Copy image address).")
    if not os.path.splitext(path_name)[1]:
        path_name += mimetypes.guess_extension(mime) or ""
    return Fetched(data=bytes(buf), mime_type=mime, filename=path_name.replace("\\", "_").replace("/", "_")[:200], url=url)
