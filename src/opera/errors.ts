/** OPERA(OHIP) 호출이 비정상 응답을 돌려줬을 때 던지는 오류. */
export class OperaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'OperaApiError';
  }
}

/** 인증(토큰 발급/갱신) 단계에서 실패했을 때. */
export class OperaAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OperaAuthError';
  }
}
