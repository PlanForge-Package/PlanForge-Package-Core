import { env } from '../config/env.js';
import type { Reservation } from '../schemas/reservation.js';

/**
 * Declares only the parts of the OHIP response we actually use.
 *
 * Field names follow common OHIP conventions but are a guess. When the real spec
 * arrives, fix this file and mock-transport together and nothing else changes.
 * That is why the mapping lives in one place.
 */
export interface OperaReservationPayload {
  reservationId?: string;
  reservationIdList?: Array<{ id?: string; type?: string }>;
  confirmationNumber?: string;
  hotelId?: string;
  reservationStatus?: string;
  roomStay?: {
    arrivalDate?: string;
    departureDate?: string;
    roomType?: string;
    ratePlanCode?: string;
    roomId?: string;
    shareGroupId?: string;
    adultCount?: number;
    childCount?: number;
    total?: { amount?: number; currencyCode?: string };
    blockCode?: string;
  };
  /** Source of business. OPERA puts it on the reservation, not on roomStay. */
  sourceOfBusiness?: {
    sourceCode?: string;
    marketCode?: string;
    channelCode?: string;
  };
  guest?: {
    profileId?: string;
    givenName?: string;
    surname?: string;
    email?: string;
  };
  /** Guarantee type. It decides how a no-show is handled. */
  guaranteeCode?: string;
  cancellationPenalty?: number;
}

export interface OperaReservationListPayload {
  reservations?: OperaReservationPayload[];
  totalResults?: number;
}

export function toReservation(raw: OperaReservationPayload): Reservation {
  return {
    reservationId: raw.reservationIdList?.[0]?.id ?? raw.reservationId ?? '',
    confirmationNumber: raw.confirmationNumber,
    hotelId: raw.hotelId ?? env.ohip.defaultHotelId,
    status: (raw.reservationStatus ?? 'Reserved') as Reservation['status'],
    arrivalDate: raw.roomStay?.arrivalDate ?? '',
    departureDate: raw.roomStay?.departureDate ?? '',
    roomTypeCode: raw.roomStay?.roomType,
    ratePlanCode: raw.roomStay?.ratePlanCode,
    roomNumber: raw.roomStay?.roomId,
    shareGroupId: raw.roomStay?.shareGroupId,
    adults: raw.roomStay?.adultCount,
    children: raw.roomStay?.childCount,
    totalAmount: raw.roomStay?.total?.amount,
    currency: raw.roomStay?.total?.currencyCode,
    blockCode: raw.roomStay?.blockCode,
    sourceCode: raw.sourceOfBusiness?.sourceCode,
    marketCode: raw.sourceOfBusiness?.marketCode,
    channelCode: raw.sourceOfBusiness?.channelCode,
    guaranteeCode: raw.guaranteeCode,
    cancellationPenalty: raw.cancellationPenalty,
    guest: raw.guest && {
      profileId: raw.guest.profileId,
      firstName: raw.guest.givenName,
      lastName: raw.guest.surname,
      email: raw.guest.email,
    },
  };
}

/**
 * Converts source of business into OPERA's shape.
 *
 * Sends nothing when no field is set. An empty object can read as clearing the
 * existing values.
 */
export function toOperaSourceOfBusiness(input: {
  sourceCode?: string;
  marketCode?: string;
  channelCode?: string;
}): Record<string, unknown> | undefined {
  const payload = {
    ...(input.sourceCode ? { sourceCode: input.sourceCode } : {}),
    ...(input.marketCode ? { marketCode: input.marketCode } : {}),
    ...(input.channelCode ? { channelCode: input.channelCode } : {}),
  };
  return Object.keys(payload).length > 0 ? payload : undefined;
}

/** Converts a PlanForge request into the shape OPERA expects. */
export function toOperaRoomStay(input: {
  arrivalDate?: string;
  departureDate?: string;
  roomTypeCode?: string;
  ratePlanCode?: string;
  adults?: number;
  children?: number;
  blockCode?: string;
  waitlist?: boolean;
}): Record<string, unknown> {
  return {
    ...(input.blockCode ? { blockCode: input.blockCode } : {}),
    ...(input.waitlist ? { waitlist: true } : {}),
    ...(input.arrivalDate ? { arrivalDate: input.arrivalDate } : {}),
    ...(input.departureDate ? { departureDate: input.departureDate } : {}),
    ...(input.roomTypeCode ? { roomType: input.roomTypeCode } : {}),
    ...(input.ratePlanCode ? { ratePlanCode: input.ratePlanCode } : {}),
    ...(input.adults === undefined ? {} : { adultCount: input.adults }),
    ...(input.children === undefined ? {} : { childCount: input.children }),
  };
}
