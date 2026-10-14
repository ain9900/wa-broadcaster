// Thin fetch wrapper for the Django API: session cookie + CSRF header, readable errors.

export class ApiError extends Error {
  status: number;
  fields?: Record<string, unknown>;
  constructor(message: string, status: number, fields?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function cookie(name: string): string {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRFToken'] = cookie('csrftoken');
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let r: Response;
  try {
    r = await fetch('/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('The server is not responding. Is it running?', 0);
  }
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) onUnauthorized();
    throw new ApiError(data.error || `Something went wrong (${r.status}).`, r.status, data.fields);
  }
  return data as T;
}

/** Multipart upload with progress (fetch can't report upload progress). */
export function upload<T>(path: string, file: File, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.setRequestHeader('X-CSRFToken', cookie('csrftoken'));
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        if (xhr.status === 401) onUnauthorized();
        reject(new ApiError(data.error || (xhr.status === 413 ? 'That file is too large.' : 'Upload failed.'), xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}
