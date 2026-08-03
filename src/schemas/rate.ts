import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const RateQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: DateString,
  departureDate: DateString,
  roomTypeCode: Type.Optional(Type.String()),
  ratePlanCode: Type.Optional(Type.String()),
});

export const NightlyRate = Type.Object({
  date: Type.String(),
  amount: Type.Number(),
});

export const RateOffer = Type.Object({
  ratePlanCode: Type.String(),
  roomTypeCode: Type.String(),
  roomTypeName: Type.Optional(Type.String()),
  currency: Type.String(),
  /** 일자별 단가. 시즌·요일에 따라 달라질 수 있어 총액만으로는 부족하다. */
  nightlyRates: Type.Array(NightlyRate),
  totalAmount: Type.Number(),
});

export const RateResponse = Type.Object({
  hotelId: Type.String(),
  arrivalDate: Type.String(),
  departureDate: Type.String(),
  nights: Type.Integer(),
  offers: Type.Array(RateOffer),
});

export type RateQuery = Static<typeof RateQuery>;
export type RateResponse = Static<typeof RateResponse>;
