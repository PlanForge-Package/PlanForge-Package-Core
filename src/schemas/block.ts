import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

/** OPERA block status. Inventory is actually held from Definite onwards. */
export const BlockStatus = Type.Union(
  [
    Type.Literal('Inquiry'),
    Type.Literal('Tentative'),
    Type.Literal('Definite'),
    Type.Literal('Cancelled'),
    Type.Literal('Actual'),
  ],
  { description: 'OPERA 블록 상태' },
);

/** Allotment per room type and date. The smallest unit of block inventory. */
export const BlockAllotment = Type.Object({
  date: Type.String(),
  roomTypeCode: Type.String(),
  /** Rooms held. */
  blocked: Type.Integer(),
  /** Rooms actually picked up. */
  pickedUp: Type.Integer(),
  ratePlanCode: Type.Optional(Type.String()),
  amount: Type.Optional(Type.Number()),
});

export const Block = Type.Object({
  blockId: Type.String(),
  /** Block code used when booking. */
  code: Type.String(),
  name: Type.String(),
  hotelId: Type.String(),
  status: BlockStatus,
  startDate: Type.String(),
  endDate: Type.String(),
  /**
   * Cut-off. After this date the held rooms return to general inventory.
   * How long unfilled group rooms stay held has a direct revenue impact.
   */
  cutoffDate: Type.Optional(Type.String()),
  currency: Type.Optional(Type.String()),
  allotments: Type.Array(BlockAllotment),
  totalBlocked: Type.Integer(),
  totalPickedUp: Type.Integer(),
});

export const BlockListQuery = Type.Object({
  hotelId: HotelIdQuery,
  status: Type.Optional(BlockStatus),
  /** Blocks starting on or after this date. */
  startFrom: Type.Optional(DateString),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const BlockListResponse = Type.Object({
  items: Type.Array(Block),
  limit: Type.Integer(),
  offset: Type.Integer(),
  total: Type.Optional(Type.Integer()),
});

export const BlockIdParams = Type.Object({
  blockId: Type.String({ minLength: 1 }),
});

export const CreateBlockBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  code: Type.String({ minLength: 1, maxLength: 20 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  startDate: DateString,
  endDate: DateString,
  cutoffDate: Type.Optional(DateString),
  status: Type.Optional(BlockStatus),
  allotments: Type.Array(
    Type.Object({
      roomTypeCode: Type.String({ minLength: 1 }),
      /** Same count for the whole range. Per-date changes go through update. */
      blocked: Type.Integer({ minimum: 0, maximum: 999 }),
      ratePlanCode: Type.Optional(Type.String()),
      /**
       * Negotiated amount. When set it overrides the rate plan's price.
       *
       * Groups agree their own price — holding at rack rate makes the rooming
       * list pick up at a different amount than the contract says.
       */
      amount: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    { minItems: 1 },
  ),
});

export const UpdateBlockBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  status: Type.Optional(BlockStatus),
  cutoffDate: Type.Optional(DateString),
  /** Negotiated rate change. Only the room types sent are affected. */
  rates: Type.Optional(
    Type.Array(
      Type.Object({
        roomTypeCode: Type.String({ minLength: 1 }),
        ratePlanCode: Type.Optional(Type.String()),
        amount: Type.Number({ minimum: 0 }),
      }),
      { minItems: 1 },
    ),
  ),
});

export type Block = Static<typeof Block>;
export type BlockStatus = Static<typeof BlockStatus>;
export type CreateBlockBody = Static<typeof CreateBlockBody>;
export type UpdateBlockBody = Static<typeof UpdateBlockBody>;
