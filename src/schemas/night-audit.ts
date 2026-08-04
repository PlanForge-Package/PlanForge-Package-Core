import { Type, type Static } from '@sinclair/typebox';
import { HotelIdQuery } from './common.js';

export const BusinessDateQuery = Type.Object({
  hotelId: HotelIdQuery,
});

/**
 * The hotel's business date.
 *
 * Not the calendar date. Until the night audit runs it stays on yesterday even
 * past midnight. It decides which day revenue and occupancy land on, so we read
 * OPERA's value instead of computing our own.
 */
export const BusinessDate = Type.Object({
  hotelId: Type.String(),
  businessDate: Type.String(),
  /** Calendar date. A difference means the night audit has not run yet. */
  calendarDate: Type.String(),
});

export const NoShowBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

export type BusinessDate = Static<typeof BusinessDate>;
export type NoShowBody = Static<typeof NoShowBody>;
