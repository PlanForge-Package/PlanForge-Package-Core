import { env } from '../config/env.js';
import { OperaApiError } from './errors.js';
import { mockOperaRequest } from './mock-transport.js';
import { tokenStore } from './token-store.js';

export interface OperaRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Hotel code. Falls back to OHIP_HOTEL_ID. */
  hotelId?: string;
}

function buildUrl(path: string, query: OperaRequestOptions['query']): URL {
  const url = new URL(path.replace(/^\//, ''), env.ohip.baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * OHIP REST call wrapper.
 *
 * On 401 it reissues the token once and retries. Other errors propagate — the
 * caller (BE) owns the retry policy.
 */
export async function operaRequest<T>(path: string, options: OperaRequestOptions = {}): Promise<T> {
  // Mock mode replaces only the transport. Callers and mapping run as they do live.
  if (env.ohip.mode === 'mock') {
    return mockOperaRequest<T>(path, options);
  }

  const { method = 'GET', query, body, hotelId } = options;
  const url = buildUrl(path, query);

  const send = async (token: string): Promise<Response> =>
    fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-app-key': env.ohip.appKey,
        'x-hotelid': hotelId ?? env.ohip.defaultHotelId,
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(env.ohip.requestTimeoutMs),
    });

  let res = await send(await tokenStore.getToken());

  if (res.status === 401) {
    tokenStore.invalidate();
    res = await send(await tokenStore.getToken());
  }

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new OperaApiError(res.status, parsed, `${method} ${url.pathname} → ${res.status}`);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
