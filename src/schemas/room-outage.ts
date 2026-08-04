import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

/**
 * Two ways to take a room off sale.
 *
 * OPERA distinguishes them. The names look alike, but they report differently.
 *
 *
 * - `OutOfOrder` — physically unusable (leak, construction). **Leaves inventory.**
 *   Both sellable rooms and the occupancy denominator drop. With 20 rooms, 2 OOO
 *   and 15 sold, occupancy is 15/18.
 * - `OutOfService` — the room is fine, we just are not selling it (hold rooms,
 *   light maintenance). **Stays in inventory.** The denominator is still 20, so 15/20.
 *
 * Booking maintenance as OOO reports occupancy higher than reality, as OOS lower.
 * Which to use is the hotel's call, so we offer both and force neither.
 */
export const RoomOutageKind = Type.Union(
  [Type.Literal('OutOfOrder'), Type.Literal('OutOfService')],
  {
    description: '재고 제외(OutOfOrder) / 판매 중지(OutOfService)',
  },
);

export const RoomOutage = Type.Object({
  outageId: Type.String(),
  hotelId: Type.String(),
  roomNumber: Type.String(),
  roomType: Type.Optional(Type.String()),
  kind: RoomOutageKind,
  /** First day out of service (inclusive). */
  startDate: DateString,
  /** Last day out of service (inclusive). Selling resumes the next day. */
  endDate: DateString,
  reason: Type.String(),
  /** Housekeeping status to restore afterwards. Usually Dirty — it needs cleaning. */
  returnStatus: Type.String(),
});

export const RoomOutageListQuery = Type.Object({
  hotelId: HotelIdQuery,
  roomNumber: Type.Optional(Type.String({ minLength: 1 })),
  /** Only outages covering this date. Omit for all of them. */
  onDate: Type.Optional(DateString),
});

export const RoomOutageListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(RoomOutage),
});

export const CreateRoomOutageBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  roomNumber: Type.String({ minLength: 1 }),
  kind: RoomOutageKind,
  startDate: DateString,
  endDate: DateString,
  // An outage with no reason is one nobody can release later. Require it.
  reason: Type.String({ minLength: 1, maxLength: 200 }),
  returnStatus: Type.Optional(Type.String({ minLength: 1 })),
});

export const RoomOutageParams = Type.Object({
  outageId: Type.String({ minLength: 1 }),
});

export const ReleaseRoomOutageBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

export type RoomOutageKind = Static<typeof RoomOutageKind>;
export type RoomOutage = Static<typeof RoomOutage>;
export type CreateRoomOutageBody = Static<typeof CreateRoomOutageBody>;
