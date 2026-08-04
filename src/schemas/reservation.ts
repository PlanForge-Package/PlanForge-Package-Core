import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const ReservationStatus = Type.Union(
  [
    Type.Literal('Reserved'),
    Type.Literal('Confirmed'),
    Type.Literal('InHouse'),
    Type.Literal('CheckedOut'),
    Type.Literal('Cancelled'),
    Type.Literal('NoShow'),
    Type.Literal('Waitlisted'),
  ],
  { description: 'OPERA 예약 상태' },
);

export const Reservation = Type.Object({
  reservationId: Type.String(),
  confirmationNumber: Type.Optional(Type.String()),
  hotelId: Type.String(),
  status: ReservationStatus,
  arrivalDate: Type.String(),
  departureDate: Type.String(),
  roomTypeCode: Type.Optional(Type.String()),
  ratePlanCode: Type.Optional(Type.String()),
  roomNumber: Type.Optional(Type.String()),
  adults: Type.Optional(Type.Integer()),
  children: Type.Optional(Type.Integer()),
  totalAmount: Type.Optional(Type.Number()),
  currency: Type.Optional(Type.String()),
  /** 단체 블록에서 빠져나온 예약이면 그 블록 코드 */
  blockCode: Type.Optional(Type.String()),
  /**
   * 예약이 들어온 경로.
   *
   * OPERA 는 세 축으로 나눈다. 셋을 하나로 합치면 "OTA 를 통해 들어온 법인 예약"
   * 같은 조합을 구분할 수 없어 채널별 수익성 판단이 무너진다.
   *
   * - source: 예약을 받은 방법 (직접·전화·워크인·OTA·GDS)
   * - market: 손님의 성격 (개인·법인·단체·레저)
   * - channel: 구체적인 판매 채널 (BOOKINGCOM·EXPEDIA·WEB …)
   */
  sourceCode: Type.Optional(Type.String()),
  marketCode: Type.Optional(Type.String()),
  channelCode: Type.Optional(Type.String()),
  guest: Type.Optional(
    Type.Object({
      profileId: Type.Optional(Type.String()),
      firstName: Type.Optional(Type.String()),
      lastName: Type.Optional(Type.String()),
      email: Type.Optional(Type.String()),
    }),
  ),
});

export const ReservationListQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: Type.Optional(DateString),
  departureDate: Type.Optional(DateString),
  status: Type.Optional(ReservationStatus),
  sourceCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  channelCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const ReservationListResponse = Type.Object({
  items: Type.Array(Reservation),
  limit: Type.Integer(),
  offset: Type.Integer(),
  total: Type.Optional(Type.Integer()),
});

export const ReservationIdParams = Type.Object({
  reservationId: Type.String({ minLength: 1 }),
});

/** 예약 생성. 요금과 재고 판단은 OPERA 가 한다 — 여기서 계산하지 않는다. */
export const CreateReservationBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  arrivalDate: DateString,
  departureDate: DateString,
  roomTypeCode: Type.String({ minLength: 1 }),
  ratePlanCode: Type.Optional(Type.String({ minLength: 1 })),
  adults: Type.Integer({ minimum: 1, maximum: 10 }),
  children: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  /** 단체 블록에서 빼는 예약이면 블록 코드를 넘긴다. 픽업으로 잡힌다. */
  blockCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  /** 예약 경로. 비우면 OPERA 가 기본값(직접 예약)으로 잡는다. */
  sourceCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  marketCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  channelCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  guest: Type.Object({
    /** 기존 OPERA 프로필이 있으면 넘긴다. 없으면 이름으로 새로 만든다. */
    profileId: Type.Optional(Type.String()),
    firstName: Type.String({ minLength: 1 }),
    lastName: Type.String({ minLength: 1 }),
    email: Type.Optional(Type.String({ format: 'email' })),
  }),
});

export const UpdateReservationBody = Type.Object({
  arrivalDate: Type.Optional(DateString),
  departureDate: Type.Optional(DateString),
  roomTypeCode: Type.Optional(Type.String({ minLength: 1 })),
  ratePlanCode: Type.Optional(Type.String({ minLength: 1 })),
  adults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  children: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
});

export const CancelReservationBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

/**
 * 체크인.
 *
 * 객실 번호를 함께 보낸다. 어느 방에 들어갔는지는 재고 그 자체이므로 OPERA 가
 * 알아야 한다 — 모르면 그 방을 다른 예약에 다시 배정한다.
 */
export const CheckInBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  roomNumber: Type.String({ minLength: 1 }),
});

export const CheckOutBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
});

export type CreateReservationBody = Static<typeof CreateReservationBody>;
export type UpdateReservationBody = Static<typeof UpdateReservationBody>;
export type CancelReservationBody = Static<typeof CancelReservationBody>;
export type CheckInBody = Static<typeof CheckInBody>;
export type CheckOutBody = Static<typeof CheckOutBody>;

export type Reservation = Static<typeof Reservation>;
export type ReservationListQuery = Static<typeof ReservationListQuery>;
export type ReservationListResponse = Static<typeof ReservationListResponse>;
export type ReservationIdParams = Static<typeof ReservationIdParams>;
