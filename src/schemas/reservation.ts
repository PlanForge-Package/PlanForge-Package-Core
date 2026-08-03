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

export type CreateReservationBody = Static<typeof CreateReservationBody>;
export type UpdateReservationBody = Static<typeof UpdateReservationBody>;
export type CancelReservationBody = Static<typeof CancelReservationBody>;

export type Reservation = Static<typeof Reservation>;
export type ReservationListQuery = Static<typeof ReservationListQuery>;
export type ReservationListResponse = Static<typeof ReservationListResponse>;
export type ReservationIdParams = Static<typeof ReservationIdParams>;
