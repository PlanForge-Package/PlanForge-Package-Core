import { Type, type Static } from '@sinclair/typebox';
import { HotelIdQuery } from './common.js';

export const TransactionCodeGroup = Type.Union([
  Type.Literal('Room'),
  Type.Literal('FoodBeverage'),
  Type.Literal('Other'),
  Type.Literal('Payment'),
]);

export const TransactionCode = Type.Object({
  transactionCode: Type.String(),
  hotelId: Type.String(),
  name: Type.String(),
  /** Revenue group. The closing journal groups by this. */
  group: Type.String(),
  vatRate: Type.Number(),
  serviceChargeRate: Type.Number(),
  /** True when tax is already inside the displayed price. */
  taxInclusive: Type.Boolean(),
  active: Type.Boolean(),
});

export const TransactionCodeListQuery = Type.Object({
  hotelId: HotelIdQuery,
  includeInactive: Type.Optional(Type.Boolean()),
});

export const TransactionCodeListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(TransactionCode),
});

export const TransactionCodeParams = Type.Object({
  transactionCode: Type.String(),
});

export const CreateTransactionCodeBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  transactionCode: Type.String({ minLength: 1, maxLength: 20 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  group: TransactionCodeGroup,
  vatRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  serviceChargeRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  taxInclusive: Type.Optional(Type.Boolean()),
});

export const UpdateTransactionCodeBody = Type.Object({
  hotelId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  group: Type.Optional(TransactionCodeGroup),
  vatRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  serviceChargeRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  taxInclusive: Type.Optional(Type.Boolean()),
  active: Type.Optional(Type.Boolean()),
});

export type TransactionCode = Static<typeof TransactionCode>;
