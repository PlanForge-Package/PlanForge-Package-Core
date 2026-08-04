import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const RateQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: DateString,
  departureDate: DateString,
  roomTypeCode: Type.Optional(Type.String()),
  ratePlanCode: Type.Optional(Type.String()),
  /** Per-person packages make the total depend on occupancy. */
  adults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

export const NightlyRate = Type.Object({
  date: Type.String(),
  amount: Type.Number(),
  /** Package amount for that night. Zero when included in the rate. */
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
  /** Nightly amounts. Seasons and weekdays vary, so a total alone is not enough. */
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
