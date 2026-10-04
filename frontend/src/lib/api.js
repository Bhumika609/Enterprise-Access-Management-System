// Thin fetch wrapper. Every route file in future stages calls one of these
// instead of using fetch() directly, so auth headers and error handling stay
// in one place.
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let authToken = null;
export function setAuthToken(token) {
  authToken = token;
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError('Cannot reach the EAPIS server. Is the backend running?', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { /* non-JSON response */ }
  }

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data;
}

// Authenticated file download (the browser can't attach the bearer token to a plain <a href>).
export async function download(path, filename) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  health: () => request('GET', '/health'),
};