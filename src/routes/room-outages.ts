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
 * Room outages.
 *
 * Deciding not to sell a room for a few days is inventory, so OPERA owns it.
 * Keeping it only in PlanForge lets a booking that arrives through OPERA land in
 * a room under maintenance.
 *
 * Paths follow common OHIP conventions but are a guess (`/hsk/v1/.../outOfOrders`).
 * When the spec arrives, fix the paths and the mapping below together. The mapping
 * stays here so this file and the mock transport are the only places to touch.
 */
export const roomOutageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/housekeeping/outages',
    {
      schema: {
        tags: ['housekeeping'],
        summary: 'Rooms out of service',
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
        summary: 'Take a room out of service — OPERA is the system of record',
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
          // Default return status is Dirty: a room out of maintenance needs cleaning.
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
        summary: 'Release an outage — the room goes back on sale',
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

/** Declares only the parts of the OHIP response we actually use. */
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
