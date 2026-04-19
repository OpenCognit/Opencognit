/**
 * Centralized fetch utility with automatic Authorization header attachment.
 */
export async function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

export class ApiError extends Error {
  status: number;
  code: string;
  path?: string;
  constructor(message: string, status: number, code: string, path?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

/**
 * authFetch + JSON parsing + structured error handling.
 * Throws ApiError with a user-friendly message on non-2xx responses.
 */
export async function authFetchJSON<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(url, options);
  } catch (e: any) {
    throw new ApiError(
      'Server nicht erreichbar. Prüfe deine Verbindung.',
      0,
      'network_error',
      url,
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => '');

  if (!res.ok) {
    const message =
      (isJson && (body as any).error) ||
      (typeof body === 'string' && body) ||
      `Request failed (${res.status})`;
    const code = (isJson && (body as any).code) || `http_${res.status}`;
    throw new ApiError(message, res.status, code, url);
  }

  return body as T;
}
