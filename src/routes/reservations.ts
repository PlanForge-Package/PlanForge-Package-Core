import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  Reservation,
  ReservationIdParams,
  ReservationListQuery,
  ReservationListResponse,
} from '../schemas/reservation.js';

export const reservationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/reservations',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 목록 조회',
        querystring: ReservationListQuery,
        response: {
          200: ReservationListResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { hotelId, arrivalDate, departureDate, status, limit = 50, offset = 0 } = request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationListPayload>(
        `/rsv/v1/hotels/${hotel}/reservations`,
        {
          hotelId: hotel,
          query: {
            arrivalStartDate: arrivalDate,
            departureEndDate: departureDate,
            reservationStatus: status,
            limit,
            offset,
          },
        },
      );

      return {
        items: (raw.reservations ?? []).map(toReservation),
        limit,
        offset,
        total: raw.totalResults,
      };
    },
  );

  app.get(
    '/v1/reservations/:reservationId',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 단건 조회',
        params: ReservationIdParams,
        response: {
          200: Reservation,
          404: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${request.params.reservationId}`,
        { hotelId: hotel },
      );

      return toReservation(raw);
    },
  );
};

function toReservation(raw: OperaReservationPayload) {
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
    guest: raw.guest && {
      profileId: raw.guest.profileId,
      firstName: raw.guest.givenName,
      lastName: raw.guest.surname,
      email: raw.guest.email,
    },
  };
}

/** OHIP 응답에서 실제로 사용하는 부분만 좁게 선언한다. */
interface OperaReservationPayload {
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
  };
  guest?: {
    profileId?: string;
    givenName?: string;
    surname?: string;
    email?: string;
  };
}

interface OperaReservationListPayload {
  reservations?: OperaReservationPayload[];
  totalResults?: number;
}
