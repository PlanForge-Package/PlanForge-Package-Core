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

export type Reservation = Static<typeof Reservation>;
export type ReservationListQuery = Static<typeof ReservationListQuery>;
export type ReservationListResponse = Static<typeof ReservationListResponse>;
export type ReservationIdParams = Static<typeof ReservationIdParams>;
