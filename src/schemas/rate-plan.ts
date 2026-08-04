import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

/** Room type to amount. A room type missing here is not sold on that rate. */
export const AmountsByRoomType = Type.Record(Type.String(), Type.Number());

export const RateSeason = Type.Object({
  seasonId: Type.String(),
  name: Type.String(),
  startDate: Type.String(),
  endDate: Type.String(),
  /** 0 = Sunday. Empty applies to every day in the range. */
  daysOfWeek: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }))),
  amounts: AmountsByRoomType,
});

export const RatePlan = Type.Object({
  ratePlanCode: Type.String(),
  hotelId: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  currency: Type.String(),
  marketCode: Type.String(),
  sellStartDate: Type.String(),
  sellEndDate: Type.String(),
  baseAmounts: AmountsByRoomType,
  seasons: Type.Array(RateSeason),
  packageCodes: Type.Array(Type.String()),
  status: Type.String(),
});

export const RatePlanListQuery = Type.Object({
  hotelId: HotelIdQuery,
  status: Type.Optional(Type.String()),
});

export const RatePlanListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(RatePlan),
});

export const RatePlanParams = Type.Object({
  ratePlanCode: Type.String(),
});

export const CreateRatePlanBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  ratePlanCode: Type.String({ minLength: 1, maxLength: 20 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  marketCode: Type.Optional(Type.String({ maxLength: 20 })),
  sellStartDate: DateString,
  sellEndDate: DateString,
  baseAmounts: AmountsByRoomType,
  packageCodes: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.Union([Type.Literal('Active'), Type.Literal('Inactive')])),
});

export const UpdateRatePlanBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  marketCode: Type.Optional(Type.String({ maxLength: 20 })),
  sellStartDate: Type.Optional(DateString),
  sellEndDate: Type.Optional(DateString),
  baseAmounts: Type.Optional(AmountsByRoomType),
  packageCodes: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.Union([Type.Literal('Active'), Type.Literal('Inactive')])),
});

export const CreateSeasonBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  startDate: DateString,
  endDate: DateString,
  daysOfWeek: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }))),
  amounts: AmountsByRoomType,
});

export const SeasonParams = Type.Object({
  ratePlanCode: Type.String(),
  seasonId: Type.String(),
});

export const DeleteSeasonBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
});

export const RatePackage = Type.Object({
  packageCode: Type.String(),
  hotelId: Type.String(),
  name: Type.String(),
  amount: Type.Number(),
  /** PerNight, PerStay (once), or PerPerson (per person per night). */
  calculation: Type.String(),
  transactionCode: Type.String(),
  /** Included in the rate leaves the total unchanged; otherwise it is added. */
  includedInRate: Type.Boolean(),
});

export const PackageListQuery = Type.Object({ hotelId: HotelIdQuery });

export const PackageListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(RatePackage),
});

export const PackageParams = Type.Object({ packageCode: Type.String() });

export const CreatePackageBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  packageCode: Type.String({ minLength: 1, maxLength: 20 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  amount: Type.Number({ minimum: 0 }),
  calculation: Type.Union([
    Type.Literal('PerNight'),
    Type.Literal('PerStay'),
    Type.Literal('PerPerson'),
  ]),
  transactionCode: Type.String({ minLength: 1, maxLength: 20 }),
  includedInRate: Type.Optional(Type.Boolean()),
});

export const UpdatePackageBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  amount: Type.Optional(Type.Number({ minimum: 0 })),
  calculation: Type.Optional(
    Type.Union([Type.Literal('PerNight'), Type.Literal('PerStay'), Type.Literal('PerPerson')]),
  ),
  transactionCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  includedInRate: Type.Optional(Type.Boolean()),
});

export type RatePlan = Static<typeof RatePlan>;
export type RatePackage = Static<typeof RatePackage>;
