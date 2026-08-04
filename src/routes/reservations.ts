import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import {
  toOperaRoomStay,
  toOperaSourceOfBusiness,
  toReservation,
  type OperaReservationListPayload,
  type OperaReservationPayload,
} from '../opera/reservation-mapper.js';
import { Type } from '@sinclair/typebox';
import { ErrorResponse, HotelIdQuery } from '../schemas/common.js';
import { NoShowBody } from '../schemas/night-audit.js';
import {
  CancelReservationBody,
  CheckInBody,
  CheckOutBody,
  ConfirmWaitlistBody,
  CreateReservationBody,
  Reservation,
  ReservationIdParams,
  ReservationListQuery,
  ReservationListResponse,
  ReservationPolicies,
  SetGuaranteeBody,
  ShareReservationBody,
  ShareResponse,
  UnshareBody,
  UpdateReservationBody,
} from '../schemas/reservation.js';

/** Declares only the parts of the OHIP response we actually use. */
interface OperaPoliciesPayload {
  reservationId?: string;
  guaranteeCode?: string;
  currencyCode?: string;
  cancellation?: {
    policyName?: string;
    freeUntil?: string;
    withinFreeWindow?: boolean;
    penaltyAmount?: number;
  };
  deposit?: { requiredAmount?: number; dueDate?: string; paidAmount?: number };
}

/**
 * OPERA is the system of record for reservations.
 *
 * We do not check inventory, price stays or issue confirmation numbers here. Two
 * systems computing the same thing eventually disagree, and then there is no
 * basis for deciding which is right. Core reshapes and forwards.
 */
export const reservationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/reservations',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 목록 조회',
        querystring: ReservationListQuery,
        response: { 200: ReservationListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const {
        hotelId,
        arrivalDate,
        departureDate,
        status,
        sourceCode,
        channelCode,
        limit = 50,
        offset = 0,
      } = request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationListPayload>(
        `/rsv/v1/hotels/${hotel}/reservations`,
        {
          hotelId: hotel,
          query: {
            arrivalStartDate: arrivalDate,
            departureEndDate: departureDate,
            reservationStatus: status,
            sourceCode,
            channelCode,
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
        response: { 200: Reservation, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}`,
        { hotelId: hotel },
      );
      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 생성 — OPERA 가 재고와 요금을 판단합니다',
        body: CreateReservationBody,
        response: {
          201: Reservation,
          400: ErrorResponse,
          // Sold out is a rejection. Send waitlist to take the booking anyway.
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { hotelId, guest, ...stay } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;
      const sourceOfBusiness = toOperaSourceOfBusiness(stay);

      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations`,
        {
          method: 'POST',
          hotelId: hotel,
          body: {
            roomStay: toOperaRoomStay(stay),
            ...(sourceOfBusiness ? { sourceOfBusiness } : {}),
            ...(stay.guaranteeCode ? { guaranteeCode: stay.guaranteeCode } : {}),
            guest: {
              ...(guest.profileId ? { profileId: guest.profileId } : {}),
              givenName: guest.firstName,
              surname: guest.lastName,
              ...(guest.email ? { email: guest.email } : {}),
            },
          },
        },
      );

      return reply.code(201).send(toReservation(raw));
    },
  );

  app.patch(
    '/v1/reservations/:reservationId',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 수정 — 날짜·객실 타입·인원',
        params: ReservationIdParams,
        body: UpdateReservationBody,
        response: { 200: Reservation, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}`,
        {
          method: 'PATCH',
          hotelId: hotel,
          body: { roomStay: toOperaRoomStay(request.body) },
        },
      );

      return toReservation(raw);
    },
  );

  /**
   * Cancellation terms and deposit.
   *
   * The guest has to hear this before we cancel. Telling them afterwards is not
   * notice, it is a bill.
   */
  app.get(
    '/v1/reservations/:reservationId/policies',
    {
      schema: {
        tags: ['reservations'],
        summary: '취소 조건·보증금 — 취소 전에 얼마를 물게 되는지',
        params: ReservationIdParams,
        querystring: Type.Object({ hotelId: HotelIdQuery }),
        response: { 200: ReservationPolicies, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaPoliciesPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(
          request.params.reservationId,
        )}/policies`,
        { hotelId: hotel },
      );

      return {
        reservationId: raw.reservationId ?? request.params.reservationId,
        guaranteeCode: raw.guaranteeCode ?? 'SIXPM',
        currency: raw.currencyCode ?? 'KRW',
        cancellation: {
          policyName: raw.cancellation?.policyName ?? '',
          freeUntil: raw.cancellation?.freeUntil ?? '',
          withinFreeWindow: Boolean(raw.cancellation?.withinFreeWindow),
          penaltyAmount: raw.cancellation?.penaltyAmount ?? 0,
        },
        deposit: {
          requiredAmount: raw.deposit?.requiredAmount ?? 0,
          ...(raw.deposit?.dueDate ? { dueDate: raw.deposit.dueDate } : {}),
          paidAmount: raw.deposit?.paidAmount ?? 0,
        },
      };
    },
  );

  app.put(
    '/v1/reservations/:reservationId/guarantee',
    {
      schema: {
        tags: ['reservations'],
        summary: '보증 방식 변경 — 노쇼를 어떻게 다룰지가 여기서 갈립니다',
        params: ReservationIdParams,
        body: SetGuaranteeBody,
        response: { 200: Reservation, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(
          request.params.reservationId,
        )}/guarantee`,
        { method: 'PUT', hotelId: hotel, body: { guaranteeCode: request.body.guaranteeCode } },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/check-in',
    {
      schema: {
        tags: ['reservations'],
        summary: '체크인 — 객실 배정을 OPERA 가 기록합니다',
        params: ReservationIdParams,
        body: CheckInBody,
        response: {
          200: Reservation,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      /*
       * Which room they walked into is inventory itself.
       *
       * If only PlanForge knows, OPERA still sees the room as free and assigns it
       * to someone else. So the status change carries the room number.
       */
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}/checkIn`,
        {
          method: 'POST',
          hotelId: hotel,
          body: { roomId: request.body.roomNumber },
        },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/check-out',
    {
      schema: {
        tags: ['reservations'],
        summary: '체크아웃 — 객실을 비우고 청소 대상으로 돌립니다',
        params: ReservationIdParams,
        body: CheckOutBody,
        response: { 200: Reservation, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}/checkOut`,
        { method: 'POST', hotelId: hotel, body: {} },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/share',
    {
      schema: {
        tags: ['reservations'],
        summary: '객실 공유 — 두 예약이 한 방을 쓰고 계산은 따로 합니다',
        params: ReservationIdParams,
        body: ShareReservationBody,
        response: {
          200: ShareResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<{
        shareGroupId?: string;
        reservations?: OperaReservationPayload[];
      }>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}/share`,
        {
          method: 'POST',
          hotelId: hotel,
          body: { withReservationId: request.body.withReservationId },
        },
      );

      return {
        shareGroupId: raw.shareGroupId ?? '',
        reservations: (raw.reservations ?? []).map(toReservation),
      };
    },
  );

  app.post(
    '/v1/reservations/:reservationId/unshare',
    {
      schema: {
        tags: ['reservations'],
        summary: '공유 해제 — 이 예약만 묶음에서 뺍니다',
        params: ReservationIdParams,
        body: UnshareBody,
        response: { 200: Reservation, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}/unshare`,
        { method: 'POST', hotelId: hotel, body: {} },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/confirm-waitlist',
    {
      schema: {
        tags: ['reservations'],
        summary: '대기 확정 — 확정 시점에 재고를 다시 확인합니다',
        params: ReservationIdParams,
        body: ConfirmWaitlistBody,
        response: {
          200: Reservation,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      /*
       * That nothing was free when it was waitlisted says nothing about now.
       *
       * Only a count at confirmation time answers it, and another waitlist entry
       * may have taken the room first. OPERA makes that call.
       */
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}/confirmWaitlist`,
        { method: 'POST', hotelId: hotel, body: {} },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/no-show',
    {
      schema: {
        tags: ['reservations'],
        summary: '노쇼 처리 — 도착일이 지나도록 오지 않은 예약',
        params: ReservationIdParams,
        body: NoShowBody,
        response: { 200: Reservation, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;

      // A no-show is a status change like a cancellation. Deleting it removes both
      // the basis for the fee and the history next season's forecast needs.
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}`,
        {
          method: 'PATCH',
          hotelId: hotel,
          body: {
            reservationStatus: 'NoShow',
            ...(request.body.reason ? { reason: request.body.reason } : {}),
          },
        },
      );

      return toReservation(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/cancel',
    {
      schema: {
        tags: ['reservations'],
        summary: '예약 취소',
        params: ReservationIdParams,
        body: CancelReservationBody,
        response: { 200: Reservation, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;

      // OPERA treats cancellation as a status change, not a delete, to keep history.
      const raw = await operaRequest<OperaReservationPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(request.params.reservationId)}`,
        {
          method: 'DELETE',
          hotelId: hotel,
          body: request.body.reason ? { reason: request.body.reason } : undefined,
        },
      );

      return toReservation(raw);
    },
  );
};
