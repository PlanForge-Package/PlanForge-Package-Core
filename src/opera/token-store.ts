import { env } from '../config/env.js';
import { OperaAuthError } from './errors.js';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * OHIP OAuth2 액세스 토큰 캐시.
 *
 * OHIP 는 password grant 로 토큰을 발급하고 수명이 짧다. 매 요청마다 발급하면
 * 레이트리밋에 걸리므로, 만료 직전까지 재사용하고 동시 갱신은 한 번으로 합친다.
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

    // 동시에 여러 요청이 만료를 감지해도 갱신은 한 번만 수행한다.
    this.#inFlight ??= this.#fetchToken().finally(() => {
      this.#inFlight = null;
    });

    return this.#inFlight;
  }

  /** 401 을 받았을 때 캐시를 버리고 다음 호출에서 강제 재발급하도록 한다. */
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
