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
 * Housekeeping — room status.
 *
 * Room status is the hotel's record, so OPERA owns it. The front desk's
 * availability view and housekeeping's cleaning view must read the same value;
 * keeping our own copy makes check-in eligibility differ between systems.
 *
 * Who cleans which room is staff scheduling, so it never goes to OPERA.
 * The BE manages that itself.
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

/** Declares only the parts of the OHIP response we actually use. */
interface OperaRoomStatusPayload {
  hotelId?: string;
  roomId?: string;
  roomStatus?: string;
  occupied?: boolean;
}

interface OperaRoomStatusListPayload {
  rooms?: OperaRoomStatusPayload[];
}
