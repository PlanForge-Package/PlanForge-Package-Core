import { Type, type Static } from '@sinclair/typebox';

/**
 * Posting type.
 *
 * The type decides the sign. Letting callers choose invites a payment sent as a
 * positive that raises the balance. Only ADJUSTMENT may pick a direction.
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
  /** Signed amount: charges positive, payments negative. */
  amount: Type.Number(),
  currencyCode: Type.String(),
  postedAt: Type.String(),
  /** External POS reference. Used for reconciliation. */
  reference: Type.Optional(Type.String()),
  /** Id of the adjustment that voided this posting, if any. */
  voidedById: Type.Optional(Type.String()),
  /** Original window, if transferred from another one. */
  transferredFromWindow: Type.Optional(Type.Integer()),
});

export const Folio = Type.Object({
  folioId: Type.String(),
  reservationId: Type.String(),
  /** OPERA folio window number (1-8). */
  window: Type.Integer(),
  status: Type.Union([Type.Literal('Open'), Type.Literal('Closed')]),
  /** Balance as calculated by OPERA. We never add it up ourselves. */
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
  /** Omit to use the next free number. */
  window: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});

export const CreatePostingBody = Type.Object({
  hotelId: HotelIdBody,
  type: PostingType,
  transactionCode: Type.String({ minLength: 1, maxLength: 20 }),
  description: Type.String({ minLength: 1, maxLength: 200 }),
  /** Always positive. The type decides whether it adds to or reduces the balance. */
  amount: Type.Number({ exclusiveMinimum: 0 }),
  /** Apply an Adjustment as a credit. Ignored for other types. */
  negative: Type.Optional(Type.Boolean()),
  /** External POS reference. The same one posts only once. */
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
});

export const VoidPostingBody = Type.Object({
  hotelId: HotelIdBody,
  reason: Type.Optional(Type.String({ maxLength: 200 })),
  /** Reference for the void adjustment. Stops a resent void from posting twice. */
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
