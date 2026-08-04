import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  CreateRoomOutageBody,
  ReleaseRoomOutageBody,
  RoomOutage,
  RoomOutageListQuery,
  RoomOutageListResponse,
  RoomOutageParams,
} from '../schemas/room-outage.js';

/**
 * 사용 불가 객실.
 *
 * 객실을 며칠 동안 팔지 않겠다는 결정은 재고 그 자체이므로 OPERA 가 원천이다.
 * PlanForge 가 따로 들고 있으면 OPERA 로 들어온 예약이 공사 중인 객실에
 * 배정된다.
 *
 * 경로는 OHIP 의 일반적인 규약을 따른 **추정치**다(`/hsk/v1/.../outOfOrders`).
 * 구독 스펙을 받으면 이 파일의 경로와 아래 매핑을 함께 맞춘다. 그때 손댈 곳이
 * 여기와 모의 전송 계층뿐이도록 매핑을 밖으로 흘리지 않는다.
 */
export const roomOutageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/housekeeping/outages',
    {
      schema: {
        tags: ['housekeeping'],
        summary: '사용 불가 객실 목록',
        querystring: RoomOutageListQuery,
        response: { 200: RoomOutageListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaOutageListPayload>(
        `/hsk/v1/hotels/${hotel}/outOfOrders`,
        {
          hotelId: hotel,
          query: { roomId: request.query.roomNumber, onDate: request.query.onDate },
        },
      );

      return { hotelId: hotel, items: (raw.outOfOrders ?? []).map((row) => toOutage(row, hotel)) };
    },
  );

  app.post(
    '/v1/housekeeping/outages',
    {
      schema: {
        tags: ['housekeeping'],
        summary: '객실을 사용 불가로 등록 — OPERA 가 기록의 원천입니다',
        body: CreateRoomOutageBody,
        response: {
          201: RoomOutage,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { hotelId, roomNumber, kind, startDate, endDate, reason, returnStatus } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaOutagePayload>(`/hsk/v1/hotels/${hotel}/outOfOrders`, {
        method: 'POST',
        hotelId: hotel,
        body: {
          roomId: roomNumber,
          kind,
          startDate,
          endDate,
          reason,
          // 복귀 상태를 정하지 않으면 Dirty 다. 공사가 끝난 객실은 청소가 필요하다.
          returnStatus: returnStatus ?? 'Dirty',
        },
      });

      return reply.code(201).send(toOutage(raw, hotel));
    },
  );

  app.delete(
    '/v1/housekeeping/outages/:outageId',
    {
      schema: {
        tags: ['housekeeping'],
        summary: '사용 불가 해제 — 객실을 다시 판매합니다',
        params: RoomOutageParams,
        body: ReleaseRoomOutageBody,
        response: { 200: RoomOutage, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaOutagePayload>(
        `/hsk/v1/hotels/${hotel}/outOfOrders/${encodeURIComponent(request.params.outageId)}`,
        {
          method: 'DELETE',
          hotelId: hotel,
          body: request.body.reason ? { reason: request.body.reason } : undefined,
        },
      );

      return toOutage(raw, hotel);
    },
  );
};

function toOutage(raw: OperaOutagePayload, fallbackHotelId: string) {
  return {
    outageId: raw.outageId ?? '',
    hotelId: raw.hotelId ?? fallbackHotelId,
    roomNumber: raw.roomId ?? '',
    roomType: raw.roomType,
    kind: (raw.kind ?? 'OutOfOrder') as RoomOutage['kind'],
    startDate: raw.startDate ?? '',
    endDate: raw.endDate ?? '',
    reason: raw.reason ?? '',
    returnStatus: raw.returnStatus ?? 'Dirty',
  };
}

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
interface OperaOutagePayload {
  outageId?: string;
  hotelId?: string;
  roomId?: string;
  roomType?: string;
  kind?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  returnStatus?: string;
}

interface OperaOutageListPayload {
  outOfOrders?: OperaOutagePayload[];
}
