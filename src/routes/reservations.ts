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
import { ErrorResponse } from '../schemas/common.js';
import { NoShowBody } from '../schemas/night-audit.js';
import {
  CancelReservationBody,
  CheckInBody,
  CheckOutBody,
  CreateReservationBody,
  Reservation,
  ReservationIdParams,
  ReservationListQuery,
  ReservationListResponse,
  UpdateReservationBody,
} from '../schemas/reservation.js';

/**
 * 예약은 OPERA 가 기록의 원천이다.
 *
 * 재고 확인·요금 계산·확인 번호 발급을 여기서 하지 않는다. 두 시스템이 각자
 * 계산하면 언젠가 값이 갈리고, 그때 어느 쪽이 맞는지 판단할 근거가 없다.
 * Core 는 형태만 바꿔 넘기고 결과를 그대로 돌려준다.
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
        response: { 201: Reservation, 400: ErrorResponse, 502: ErrorResponse },
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
       * 어느 방에 들어갔는지는 재고 그 자체다.
       *
       * PlanForge 만 알고 있으면 OPERA 는 그 방을 여전히 빈 방으로 보고 다른
       * 예약에 배정한다. 그래서 상태 전이와 객실 번호를 함께 넘긴다.
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

      // 노쇼도 취소와 마찬가지로 상태 전이다. 삭제하면 노쇼 수수료를 청구할
      // 근거와 다음 시즌 예측에 쓸 이력이 함께 사라진다.
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

      // OPERA 는 취소를 삭제가 아니라 상태 전이로 다룬다. 이력이 남아야 하기 때문이다.
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
