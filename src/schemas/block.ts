import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

/** OPERA 의 블록 상태. 확정(Definite)부터 재고를 실제로 잡는다. */
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

/** 객실 타입·일자별 할당. 블록 재고의 최소 단위다. */
export const BlockAllotment = Type.Object({
  date: Type.String(),
  roomTypeCode: Type.String(),
  /** 잡아 둔 객실 수 */
  blocked: Type.Integer(),
  /** 실제 예약으로 빠져나간 수 */
  pickedUp: Type.Integer(),
  ratePlanCode: Type.Optional(Type.String()),
  amount: Type.Optional(Type.Number()),
});

export const Block = Type.Object({
  blockId: Type.String(),
  /** 예약 시 지정하는 블록 코드 */
  code: Type.String(),
  name: Type.String(),
  hotelId: Type.String(),
  status: BlockStatus,
  startDate: Type.String(),
  endDate: Type.String(),
  /**
   * 컷오프. 이 날짜가 지나면 잡아 둔 객실이 일반 재고로 풀린다.
   * 단체가 채우지 못한 방을 언제까지 붙들고 있을지가 수익에 직결된다.
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
  /** 이 날짜 이후 시작하는 블록 */
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
      /** 기간 전체에 같은 수를 잡는다. 일자별 조정은 수정에서 한다. */
      blocked: Type.Integer({ minimum: 0, maximum: 999 }),
      ratePlanCode: Type.Optional(Type.String()),
      /**
       * 협의 요금. 넣으면 요금 코드의 계산 대신 이 금액으로 판다.
       *
       * 단체는 값을 따로 합의한다 — 정가로 잡아 두면 룸리스트가 실제 계약과
       * 다른 금액으로 빠져나간다.
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
  /** 협의 요금 조정. 보낸 객실 타입만 바꾼다. */
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
