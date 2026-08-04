import { Type, type Static } from '@sinclair/typebox';

/**
 * 거래 종류.
 *
 * 부호는 종류가 정한다. 호출자가 부호를 정하게 하면 결제를 양수로 보내 잔액이
 * 늘어나는 사고가 나기 쉽다. ADJUSTMENT 만 방향을 지정할 수 있다.
 */
export const PostingType = Type.Union(
  [
    Type.Literal('Charge'),
    Type.Literal('Payment'),
    Type.Literal('Adjustment'),
    Type.Literal('Tax'),
  ],
  { description: 'OPERA 거래 종류' },
);

export const Posting = Type.Object({
  postingId: Type.String(),
  type: PostingType,
  transactionCode: Type.String(),
  description: Type.String(),
  /** 부호가 붙은 값. 청구는 양수, 결제는 음수다. */
  amount: Type.Number(),
  currencyCode: Type.String(),
  postedAt: Type.String(),
  /** 외부 POS 전표 번호. 대사할 때 쓴다. */
  reference: Type.Optional(Type.String()),
  /** 취소되었으면 그 취소를 만든 조정의 식별자 */
  voidedById: Type.Optional(Type.String()),
  /** 다른 창구에서 옮겨 왔으면 원래 창구 */
  transferredFromWindow: Type.Optional(Type.Integer()),
});

export const Folio = Type.Object({
  folioId: Type.String(),
  reservationId: Type.String(),
  /** OPERA folio window 번호 (1~8) */
  window: Type.Integer(),
  status: Type.Union([Type.Literal('Open'), Type.Literal('Closed')]),
  /** OPERA 가 계산한 잔액. 우리가 더하지 않는다. */
  balance: Type.Number(),
  currencyCode: Type.String(),
  postings: Type.Array(Posting),
});

export const FolioListResponse = Type.Object({
  reservationId: Type.String(),
  folios: Type.Array(Folio),
});

export const FolioParams = Type.Object({
  reservationId: Type.String({ minLength: 1 }),
});

export const FolioWindowParams = Type.Object({
  reservationId: Type.String({ minLength: 1 }),
  window: Type.Integer({ minimum: 1, maximum: 8 }),
});

export const PostingParams = Type.Object({
  reservationId: Type.String({ minLength: 1 }),
  postingId: Type.String({ minLength: 1 }),
});

export const HotelIdBody = Type.Optional(Type.String({ minLength: 1 }));

export const OpenFolioBody = Type.Object({
  hotelId: HotelIdBody,
  /** 생략하면 비어 있는 다음 번호를 쓴다. */
  window: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});

export const CreatePostingBody = Type.Object({
  hotelId: HotelIdBody,
  type: PostingType,
  transactionCode: Type.String({ minLength: 1, maxLength: 20 }),
  description: Type.String({ minLength: 1, maxLength: 200 }),
  /** 항상 양수로 보낸다. 잔액에 더할지 뺄지는 type 이 정한다. */
  amount: Type.Number({ exclusiveMinimum: 0 }),
  /** Adjustment 를 차감 방향으로 적용할지. 다른 종류에서는 무시한다. */
  negative: Type.Optional(Type.Boolean()),
  /** 외부 POS 전표 번호. 같은 번호는 한 번만 달린다. */
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
});

export const VoidPostingBody = Type.Object({
  hotelId: HotelIdBody,
  reason: Type.Optional(Type.String({ maxLength: 200 })),
  /** 취소 조정에 붙일 전표 번호. 취소 요청 재전송을 여기서 막는다. */
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
});

export const TransferPostingBody = Type.Object({
  hotelId: HotelIdBody,
  toWindow: Type.Integer({ minimum: 1, maximum: 8 }),
});

export const CloseFolioBody = Type.Object({
  hotelId: HotelIdBody,
});

export type PostingType = Static<typeof PostingType>;
export type Posting = Static<typeof Posting>;
export type Folio = Static<typeof Folio>;
export type CreatePostingBody = Static<typeof CreatePostingBody>;
