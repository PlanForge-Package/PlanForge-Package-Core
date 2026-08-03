import { env } from '../config/env.js';
import type { Reservation } from '../schemas/reservation.js';

/**
 * OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다.
 *
 * 필드 이름은 일반적인 OHIP 규약을 따른 **추정치**다. 실제 구독 스펙을 받으면
 * 이 파일과 mock-transport 를 함께 맞추면 되고, 나머지 코드는 손대지 않아도 된다.
 * 매핑을 한 곳에 모아 둔 이유가 이것이다.
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
    adultCount?: number;
    childCount?: number;
    total?: { amount?: number; currencyCode?: string };
    blockCode?: string;
  };
  guest?: {
    profileId?: string;
    givenName?: string;
    surname?: string;
    email?: string;
  };
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
    adults: raw.roomStay?.adultCount,
    children: raw.roomStay?.childCount,
    totalAmount: raw.roomStay?.total?.amount,
    currency: raw.roomStay?.total?.currencyCode,
    blockCode: raw.roomStay?.blockCode,
    guest: raw.guest && {
      profileId: raw.guest.profileId,
      firstName: raw.guest.givenName,
      lastName: raw.guest.surname,
      email: raw.guest.email,
    },
  };
}

/** PlanForge 요청을 OPERA 가 기대하는 형태로 바꾼다. */
export function toOperaRoomStay(input: {
  arrivalDate?: string;
  departureDate?: string;
  roomTypeCode?: string;
  ratePlanCode?: string;
  adults?: number;
  children?: number;
  blockCode?: string;
}): Record<string, unknown> {
  return {
    ...(input.blockCode ? { blockCode: input.blockCode } : {}),
    ...(input.arrivalDate ? { arrivalDate: input.arrivalDate } : {}),
    ...(input.departureDate ? { departureDate: input.departureDate } : {}),
    ...(input.roomTypeCode ? { roomType: input.roomTypeCode } : {}),
    ...(input.ratePlanCode ? { ratePlanCode: input.ratePlanCode } : {}),
    ...(input.adults === undefined ? {} : { adultCount: input.adults }),
    ...(input.children === undefined ? {} : { childCount: input.children }),
  };
}
