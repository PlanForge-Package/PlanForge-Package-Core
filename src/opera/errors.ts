/** Thrown when an OPERA (OHIP) call returns an error response. */
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

/** Thrown when token issue or refresh fails. */
export class OperaAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OperaAuthError';
  }
}
