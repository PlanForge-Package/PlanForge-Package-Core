import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from './token-store.js';

function mockTokenResponse(token: string, expiresIn = 3600): Response {
  return new Response(
    JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TokenStore', () => {
  it('유효한 토큰은 재사용해 재발급하지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockTokenResponse('t1'));
    const store = new TokenStore();

    await expect(store.getToken()).resolves.toBe('t1');
    await expect(store.getToken()).resolves.toBe('t1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('동시 요청이 몰려도 발급은 한 번만 수행한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockTokenResponse('t1'));
    const store = new TokenStore();

    await Promise.all([store.getToken(), store.getToken(), store.getToken()]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidate 후에는 다시 발급한다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockTokenResponse('t1'))
      .mockResolvedValueOnce(mockTokenResponse('t2'));
    const store = new TokenStore();

    await expect(store.getToken()).resolves.toBe('t1');
    store.invalidate();
    await expect(store.getToken()).resolves.toBe('t2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('발급이 실패하면 OperaAuthError 를 던진다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const store = new TokenStore();

    await expect(store.getToken()).rejects.toThrow(/OHIP 토큰 발급 실패/);
  });
});
