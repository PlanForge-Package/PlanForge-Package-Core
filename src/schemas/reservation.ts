import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

export const ReservationStatus = Type.Union(
  [
    Type.Literal('Reserved'),
    Type.Literal('Confirmed'),
    Type.Literal('InHouse'),
    Type.Literal('CheckedOut'),
    Type.Literal('Cancelled'),
    Type.Literal('NoShow'),
    Type.Literal('Waitlisted'),
  ],
  { description: 'OPERA 예약 상태' },
);

export const Reservation = Type.Object({
  reservationId: Type.String(),
  confirmationNumber: Type.Optional(Type.String()),
  hotelId: Type.String(),
  status: ReservationStatus,
  arrivalDate: Type.String(),
  departureDate: Type.String(),
  roomTypeCode: Type.Optional(Type.String()),
  ratePlanCode: Type.Optional(Type.String()),
  roomNumber: Type.Optional(Type.String()),
  adults: Type.Optional(Type.Integer()),
  children: Type.Optional(Type.Integer()),
  totalAmount: Type.Optional(Type.Number()),
  currency: Type.Optional(Type.String()),
  /** Block code, if this reservation was picked up from a group block. */
  blockCode: Type.Optional(Type.String()),
  /**
   * Reservations that share one room.
   *
   * Two guests, one room, separate folios. Two reservations but only one room,
   * so they consume a single unit of inventory.
   */
  shareGroupId: Type.Optional(Type.String()),
  /**
   * Guarantee type — SIXPM, CREDITCARD, DEPOSIT, COMPANY, COMP.
   *
   * It decides what we can charge on a no-show.
   */
  guaranteeCode: Type.Optional(Type.String()),
  /** Penalty charged on cancellation. Present only on cancelled reservations. */
  cancellationPenalty: Type.Optional(Type.Number()),
  /**
   * Where the booking came from.
   *
   * OPERA splits this three ways. Collapsing them loses combinations like
   * "corporate booking that arrived through an OTA", and channel profitability
   * stops being answerable.
   *
   * - source: how it was taken (direct, phone, walk-in, OTA, GDS)
   * - market: what kind of guest (transient, corporate, group, leisure)
   * - channel: the specific seller (BOOKINGCOM, EXPEDIA, WEB …)
   */
  sourceCode: Type.Optional(Type.String()),
  marketCode: Type.Optional(Type.String()),
  channelCode: Type.Optional(Type.String()),
  guest: Type.Optional(
    Type.Object({
      profileId: Type.Optional(Type.String()),
      firstName: Type.Optional(Type.String()),
      lastName: Type.Optional(Type.String()),
      email: Type.Optional(Type.String()),
    }),
  ),
});

export const ReservationListQuery = Type.Object({
  hotelId: HotelIdQuery,
  arrivalDate: Type.Optional(DateString),
  departureDate: Type.Optional(DateString),
  status: Type.Optional(ReservationStatus),
  sourceCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  channelCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const ReservationListResponse = Type.Object({
  items: Type.Array(Reservation),
  limit: Type.Integer(),
  offset: Type.Integer(),
  total: Type.Optional(Type.Integer()),
});

export const ReservationIdParams = Type.Object({
  reservationId: Type.String({ minLength: 1 }),
});

/** Create a reservation. OPERA decides inventory and price; we do not compute. */
export const CreateReservationBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  arrivalDate: DateString,
  departureDate: DateString,
  roomTypeCode: Type.String({ minLength: 1 }),
  ratePlanCode: Type.Optional(Type.String({ minLength: 1 })),
  adults: Type.Integer({ minimum: 1, maximum: 10 }),
  children: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  /** Block code when picking up from a group block. OPERA counts it as pickup. */
  blockCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  /**
   * Take a waitlist booking even when nothing is free.
   *
   * A waitlisted reservation holds no inventory and is confirmed when a room opens.
   * Without this flag, a sold-out request is rejected outright.
   */
  waitlist: Type.Optional(Type.Boolean()),
  /** Source of business. Empty lets OPERA default it to a direct booking. */
  sourceCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  marketCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  channelCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  /** Guarantee type. Empty means 6PM — an unguaranteed booking is held until 18:00. */
  guaranteeCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  guest: Type.Object({
    /** Pass an existing OPERA profile id. Without one, a profile is created by name. */
    profileId: Type.Optional(Type.String()),
    firstName: Type.String({ minLength: 1 }),
    lastName: Type.String({ minLength: 1 }),
    email: Type.Optional(Type.String({ format: 'email' })),
  }),
});

/** Cancellation terms and deposit. The guest hears this before we cancel. */
export const ReservationPolicies = Type.Object({
  reservationId: Type.String(),
  guaranteeCode: Type.String(),
  currency: Type.String(),
  cancellation: Type.Object({
    policyName: Type.String(),
    /** Cancelling is free until this moment. */
    freeUntil: Type.String(),
    withinFreeWindow: Type.Boolean(),
    penaltyAmount: Type.Number(),
  }),
  deposit: Type.Object({
    requiredAmount: Type.Number(),
    dueDate: Type.Optional(Type.String()),
    paidAmount: Type.Number(),
  }),
});

export const SetGuaranteeBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  guaranteeCode: Type.String({ minLength: 1, maxLength: 20 }),
});

export const DepositBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  amount: Type.Number({ exclusiveMinimum: 0 }),
  description: Type.Optional(Type.String({ maxLength: 200 })),
  transactionCode: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  /** Reference that stops the same deposit being taken twice. */
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
});

export const UpdateReservationBody = Type.Object({
  arrivalDate: Type.Optional(DateString),
  departureDate: Type.Optional(DateString),
  roomTypeCode: Type.Optional(Type.String({ minLength: 1 })),
  ratePlanCode: Type.Optional(Type.String({ minLength: 1 })),
  adults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  children: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
});

export const CancelReservationBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

/**
 * Check-in.
 *
 * Carries the room number. Which room the guest walked into is inventory itself,
 * and OPERA has to know — otherwise it assigns that room to someone else.
 */
export const CheckInBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  roomNumber: Type.String({ minLength: 1 }),
});

export const CheckOutBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
});

export const ShareReservationBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  /** The reservation to share with. */
  withReservationId: Type.String({ minLength: 1 }),
});

export const ShareResponse = Type.Object({
  shareGroupId: Type.String(),
  reservations: Type.Array(Reservation),
});

export const UnshareBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
});

/** Waitlist confirmation. Availability is re-checked then, so the body is empty. */
export const ConfirmWaitlistBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
});

export type CreateReservationBody = Static<typeof CreateReservationBody>;
export type UpdateReservationBody = Static<typeof UpdateReservationBody>;
export type CancelReservationBody = Static<typeof CancelReservationBody>;
export type CheckInBody = Static<typeof CheckInBody>;
export type CheckOutBody = Static<typeof CheckOutBody>;
export type ConfirmWaitlistBody = Static<typeof ConfirmWaitlistBody>;
export type ShareReservationBody = Static<typeof ShareReservationBody>;
export type ShareResponse = Static<typeof ShareResponse>;
export type ReservationPolicies = Static<typeof ReservationPolicies>;
export type SetGuaranteeBody = Static<typeof SetGuaranteeBody>;
export type DepositBody = Static<typeof DepositBody>;

export type Reservation = Static<typeof Reservation>;
export type ReservationListQuery = Static<typeof ReservationListQuery>;
export type ReservationListResponse = Static<typeof ReservationListResponse>;
export type ReservationIdParams = Static<typeof ReservationIdParams>;
