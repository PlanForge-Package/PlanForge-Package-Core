import { Type, type Static } from '@sinclair/typebox';
import { HotelIdQuery } from './common.js';

export const BusinessDateQuery = Type.Object({
  hotelId: HotelIdQuery,
});

/**
 * 호텔의 영업일.
 *
 * 달력 날짜와 다르다. 야간 감사를 돌리기 전까지는 자정을 넘겨도 어제가 영업일로
 * 남는다. 매출·점유율이 어느 날짜에 붙는지가 여기서 정해지므로, 우리가 자체로
 * 계산하지 않고 OPERA 가 들고 있는 값을 그대로 읽는다.
 */
export const BusinessDate = Type.Object({
  hotelId: Type.String(),
  businessDate: Type.String(),
  /** 달력 날짜. 영업일과 다르면 아직 야간 감사가 돌지 않았다는 뜻이다. */
  calendarDate: Type.String(),
});

export const NoShowBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

export type BusinessDate = Static<typeof BusinessDate>;
export type NoShowBody = Static<typeof NoShowBody>;
