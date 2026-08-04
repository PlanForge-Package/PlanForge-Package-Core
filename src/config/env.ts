import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3002')),
  host: optional('HOST', '0.0.0.0'),
  logLevel: optional('LOG_LEVEL', 'info'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:3000,http://localhost:3001').split(','),

  /**
   * Key an internal service (BE) must present to call Core.
   * Empty skips authentication — development only.
   */
  serviceApiKey: process.env.SERVICE_API_KEY ?? '',

  /** Oracle Hospitality Integration Platform */
  ohip: {
    /**
     * `mock` returns OPERA-shaped responses without calling OHIP.
     *
     * It lets us build and verify FE and BE end to end without a subscription
     * spec or credentials. Response shapes and mapping code are identical to the
     * live path, so only the transport changes at cut-over.
     */
    mode: optional('OHIP_MODE', 'mock') === 'live' ? ('live' as const) : ('mock' as const),
    baseUrl: optional('OHIP_BASE_URL', 'https://api.oracle-hospitality.example/'),
    /** Application key issued by the OHIP gateway (x-app-key). */
    appKey: process.env.OHIP_APP_KEY ?? '',
    clientId: process.env.OHIP_CLIENT_ID ?? '',
    clientSecret: process.env.OHIP_CLIENT_SECRET ?? '',
    /** OPERA Cloud integration user. */
    username: process.env.OHIP_USERNAME ?? '',
    password: process.env.OHIP_PASSWORD ?? '',
    /** Default hotel code (e.g. SAND01). */
    defaultHotelId: process.env.OHIP_HOTEL_ID ?? '',
    /** How many seconds before expiry to refresh the token. */
    tokenRefreshSkewSeconds: Number(optional('OHIP_TOKEN_REFRESH_SKEW_SECONDS', '60')),
    requestTimeoutMs: Number(optional('OHIP_REQUEST_TIMEOUT_MS', '15000')),
  },
} as const;

/** Fail at startup when a required value is missing in production. */
export function assertProductionEnv(): void {
  if (env.nodeEnv !== 'production') return;

  required('SERVICE_API_KEY');

  // Mock mode in production puts fake reservations into circulation. Refuse to boot.
  if (env.ohip.mode !== 'live') {
    throw new Error('운영 환경에서는 OHIP_MODE=live 여야 합니다.');
  }

  required('OHIP_BASE_URL');
  required('OHIP_APP_KEY');
  required('OHIP_CLIENT_ID');
  required('OHIP_CLIENT_SECRET');
  required('OHIP_USERNAME');
  required('OHIP_PASSWORD');
}
