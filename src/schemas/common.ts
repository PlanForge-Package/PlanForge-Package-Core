import { Type, type Static } from '@sinclair/typebox';

export const HotelIdQuery = Type.Optional(
  Type.String({ description: 'OPERA 호텔 코드. 생략하면 서버 기본값을 사용합니다.', minLength: 1 }),
);

export const DateString = Type.String({
  format: 'date',
  description: 'ISO 8601 날짜 (YYYY-MM-DD)',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});

export const ErrorResponse = Type.Object(
  {
    statusCode: Type.Integer(),
    error: Type.String(),
    message: Type.String(),
  },
  { $id: 'ErrorResponse' },
);

export type ErrorResponse = Static<typeof ErrorResponse>;
