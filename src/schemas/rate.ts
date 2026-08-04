import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const RateQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: DateString,
  departureDate: DateString,
  roomTypeCode: Type.Optional(Type.String()),
  ratePlanCode: Type.Optional(Type.String()),
  /** 1인당 붙는 패키지가 있어 인원에 따라 총액이 달라진다. */
  adults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

export const NightlyRate = Type.Object({
  date: Type.String(),
  amount: Type.Number(),
  /** 그날 붙는 패키지 금액. 요금에 포함된 패키지는 0 이다. */
  packageAmount: Type.Optional(Type.Number()),
});

export const RateOfferPackage = Type.Object({
  packageCode: Type.String(),
  name: Type.String(),
  amount: Type.Number(),
  calculation: Type.String(),
  includedInRate: Type.Boolean(),
});

export const RateOffer = Type.Object({
  ratePlanCode: Type.String(),
  ratePlanName: Type.Optional(Type.String()),
  roomTypeCode: Type.String(),
  roomTypeName: Type.Optional(Type.String()),
  currency: Type.String(),
  /** 일자별 단가. 시즌·요일에 따라 달라질 수 있어 총액만으로는 부족하다. */
  nightlyRates: Type.Array(NightlyRate),
  packages: Type.Optional(Type.Array(RateOfferPackage)),
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
