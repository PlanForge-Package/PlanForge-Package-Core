import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const AvailabilityQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: DateString,
  departureDate: DateString,
  adults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 1 })),
  children: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, default: 0 })),
  roomTypeCode: Type.Optional(Type.String({ description: 'OPERA 객실 타입 코드' })),
});

export const AvailabilityItem = Type.Object({
  roomTypeCode: Type.String(),
  roomTypeName: Type.Optional(Type.String()),
  availableRooms: Type.Integer(),
  ratePlanCode: Type.Optional(Type.String()),
  amount: Type.Optional(Type.Number()),
  currency: Type.Optional(Type.String()),
});

export const AvailabilityResponse = Type.Object({
  hotelId: Type.String(),
  arrivalDate: Type.String(),
  departureDate: Type.String(),
  items: Type.Array(AvailabilityItem),
});

export type AvailabilityQuery = Static<typeof AvailabilityQuery>;
export type AvailabilityResponse = Static<typeof AvailabilityResponse>;
