import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  RoomStatusListQuery,
  RoomStatusListResponse,
  RoomStatusParams,
  RoomStatusResponse,
  UpdateRoomStatusBody,
} from '../schemas/housekeeping.js';

/**
 * 하우스키핑 — 객실 상태.
 *
 * 객실 상태는 호텔의 기록이므로 OPERA 가 원천이다. 프론트데스크의 재고 판단과
 * 하우스키핑의 청소 상태가 같은 값을 봐야 하는데, PlanForge 가 따로 들고 있으면
 * 체크인 가능 여부가 두 시스템에서 달라진다.
 *
 * 반면 "누가 어느 객실을 청소하는가" 는 직원 근무 편성이라 OPERA 에 보내지 않는다.
 * BE 가 자체 관리한다.
 */
export const housekeepingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/housekeeping/rooms',
    {
      schema: {
        tags: ['housekeeping'],
        summary: '객실 상태 목록',
        querystring: RoomStatusListQuery,
        response: { 200: RoomStatusListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRoomStatusListPayload>(`/hsk/v1/hotels/${hotel}/rooms`, {
        hotelId: hotel,
        query: { roomStatus: request.query.status },
      });

      return {
        hotelId: hotel,
        items: (raw.rooms ?? []).map(toRoomStatus),
      };
    },
  );

  app.put(
    '/v1/housekeeping/rooms/:roomNumber/status',
    {
      schema: {
        tags: ['housekeeping'],
        summary: '객실 상태 변경 — OPERA 가 기록의 원천입니다',
        params: RoomStatusParams,
        body: UpdateRoomStatusBody,
        response: {
          200: RoomStatusResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { hotelId, status, reason } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRoomStatusPayload>(
        `/hsk/v1/hotels/${hotel}/rooms/${encodeURIComponent(request.params.roomNumber)}/status`,
        {
          method: 'PUT',
          hotelId: hotel,
          body: { roomStatus: status, ...(reason ? { reason } : {}) },
        },
      );

      return toRoomStatus(raw);
    },
  );
};

function toRoomStatus(raw: OperaRoomStatusPayload) {
  return {
    hotelId: raw.hotelId ?? env.ohip.defaultHotelId,
    roomNumber: raw.roomId ?? '',
    status: (raw.roomStatus ?? 'Dirty') as RoomStatusResponse['status'],
    occupied: raw.occupied,
  };
}

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
interface OperaRoomStatusPayload {
  hotelId?: string;
  roomId?: string;
  roomStatus?: string;
  occupied?: boolean;
}

interface OperaRoomStatusListPayload {
  rooms?: OperaRoomStatusPayload[];
}
