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
   * Core 를 호출하는 내부 서비스(BE)가 제시해야 하는 키.
   * 값이 비어 있으면 인증을 건너뛴다 — 개발 환경 전용.
   */
  serviceApiKey: process.env.SERVICE_API_KEY ?? '',

  /** Oracle Hospitality Integration Platform */
  ohip: {
    /**
     * `mock` 이면 OHIP 로 나가지 않고 OPERA 형태의 모의 응답을 돌려준다.
     *
     * 구독 스펙과 자격 증명이 없어도 FE·BE 까지 전 구간을 개발하고 검증하기
     * 위해서다. 응답 형태와 매핑 코드는 실제 경로와 동일하게 태우므로,
     * 나중에 live 로 바꿀 때 달라지는 것은 전송 계층뿐이다.
     */
    mode: optional('OHIP_MODE', 'mock') === 'live' ? ('live' as const) : ('mock' as const),
    baseUrl: optional('OHIP_BASE_URL', 'https://api.oracle-hospitality.example/'),
    /** OHIP Gateway 에서 발급한 애플리케이션 키 (x-app-key) */
    appKey: process.env.OHIP_APP_KEY ?? '',
    clientId: process.env.OHIP_CLIENT_ID ?? '',
    clientSecret: process.env.OHIP_CLIENT_SECRET ?? '',
    /** OPERA Cloud 통합 사용자 */
    username: process.env.OHIP_USERNAME ?? '',
    password: process.env.OHIP_PASSWORD ?? '',
    /** 기본 호텔 코드 (예: SAND01) */
    defaultHotelId: process.env.OHIP_HOTEL_ID ?? '',
    /** 토큰을 만료 몇 초 전에 미리 갱신할지 */
    tokenRefreshSkewSeconds: Number(optional('OHIP_TOKEN_REFRESH_SKEW_SECONDS', '60')),
    requestTimeoutMs: Number(optional('OHIP_REQUEST_TIMEOUT_MS', '15000')),
  },
} as const;

/** 운영 환경에서 필수 값이 비어 있으면 기동 시점에 실패시킨다. */
export function assertProductionEnv(): void {
  if (env.nodeEnv !== 'production') return;

  required('SERVICE_API_KEY');

  // 모의 모드로 운영에 뜨면 가짜 예약이 진짜처럼 돌아다닌다. 기동을 막는다.
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
