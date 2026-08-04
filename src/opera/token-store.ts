import { env } from '../config/env.js';
import { OperaAuthError } from './errors.js';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * OHIP OAuth2 access token cache.
 *
 * OHIP issues short-lived tokens via password grant. Requesting one per call hits
 * the rate limit, so we reuse until just before expiry and collapse concurrent refreshes.
 */
export class TokenStore {
  #token: string | null = null;
  #expiresAt = 0;
  #inFlight: Promise<string> | null = null;

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.#token && now < this.#expiresAt) {
      return this.#token;
    }

    // Several requests may notice expiry at once; refresh runs only once.
    this.#inFlight ??= this.#fetchToken().finally(() => {
      this.#inFlight = null;
    });

    return this.#inFlight;
  }

  /** Drops the cache after a 401 so the next call forces a reissue. */
  invalidate(): void {
    this.#token = null;
    this.#expiresAt = 0;
  }

  async #fetchToken(): Promise<string> {
    const { baseUrl, appKey, clientId, clientSecret, username, password, tokenRefreshSkewSeconds } =
      env.ohip;

    const body = new URLSearchParams({
      grant_type: 'password',
      username,
      password,
    });

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let res: Response;
    try {
      res = await fetch(new URL('/oauth/v1/tokens', baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-app-key': appKey,
          authorization: `Basic ${basic}`,
        },
        body,
        signal: AbortSignal.timeout(env.ohip.requestTimeoutMs),
      });
    } catch (cause) {
      throw new OperaAuthError('OHIP 토큰 엔드포인트 호출에 실패했습니다.', cause);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OperaAuthError(`OHIP 토큰 발급 실패 (${res.status}): ${text}`);
    }

    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) {
      throw new OperaAuthError('OHIP 토큰 응답에 access_token 이 없습니다.');
    }

    this.#token = json.access_token;
    this.#expiresAt = Date.now() + Math.max(0, json.expires_in - tokenRefreshSkewSeconds) * 1000;

    return this.#token;
  }
}

export const tokenStore = new TokenStore();
