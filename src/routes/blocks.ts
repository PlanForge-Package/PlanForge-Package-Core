import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import {
  toBlock,
  type OperaBlockListPayload,
  type OperaBlockPayload,
} from '../opera/block-mapper.js';
import { operaRequest } from '../opera/client.js';
import { toReservation, type OperaReservationListPayload } from '../opera/reservation-mapper.js';
import {
  Block,
  BlockIdParams,
  BlockListQuery,
  BlockListResponse,
  CreateBlockBody,
  UpdateBlockBody,
} from '../schemas/block.js';
import { ErrorResponse } from '../schemas/common.js';
import { ReservationListResponse } from '../schemas/reservation.js';

/**
 * Group blocks.
 *
 * A block holds inventory up front, so it draws on the same pool as normal
 * bookings. If PlanForge counted separately, transient sales and group
 * allotments would see different inventory and oversell. OPERA owns it.
 */
export const blockRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/blocks',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Group blocks',
        querystring: BlockListQuery,
        response: { 200: BlockListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const { hotelId, status, startFrom, limit = 50, offset = 0 } = request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaBlockListPayload>(`/blk/v1/hotels/${hotel}/blocks`, {
        hotelId: hotel,
        query: { blockStatus: status, startDate: startFrom, limit, offset },
      });

      return {
        items: (raw.blocks ?? []).map(toBlock),
        limit,
        offset,
        total: raw.totalResults,
      };
    },
  );

  app.get(
    '/v1/blocks/:blockId',
    {
      schema: {
        tags: ['blocks'],
        summary: 'One block, with allotments by date and room type',
        params: BlockIdParams,
        response: { 200: Block, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaBlockPayload>(
        `/blk/v1/hotels/${hotel}/blocks/${encodeURIComponent(request.params.blockId)}`,
        { hotelId: hotel },
      );
      return toBlock(raw);
    },
  );

  app.get(
    '/v1/blocks/:blockId/reservations',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Rooming list — reservations picked up from this block',
        params: BlockIdParams,
        response: { 200: ReservationListResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;

      // We read the block first because we need its code: OPERA filters reservations
      // by block code, not id. An unknown block 404s here.
      const block = await operaRequest<OperaBlockPayload>(
        `/blk/v1/hotels/${hotel}/blocks/${encodeURIComponent(request.params.blockId)}`,
        { hotelId: hotel },
      );

      const raw = await operaRequest<OperaReservationListPayload>(
        `/rsv/v1/hotels/${hotel}/reservations`,
        { hotelId: hotel, query: { blockCode: block.blockCode, limit: 200 } },
      );

      return {
        items: (raw.reservations ?? []).map(toReservation),
        limit: 200,
        offset: 0,
        total: raw.totalResults,
      };
    },
  );

  app.post(
    '/v1/blocks',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Create a block — OPERA decides whether inventory can be held',
        body: CreateBlockBody,
        response: { 201: Block, 400: ErrorResponse, 409: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { hotelId, allotments, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaBlockPayload>(`/blk/v1/hotels/${hotel}/blocks`, {
        method: 'POST',
        hotelId: hotel,
        body: {
          blockCode: rest.code,
          blockName: rest.name,
          startDate: rest.startDate,
          endDate: rest.endDate,
          ...(rest.cutoffDate ? { cutoffDate: rest.cutoffDate } : {}),
          ...(rest.status ? { blockStatus: rest.status } : {}),
          roomTypeAllocations: allotments.map((slot) => ({
            roomType: slot.roomTypeCode,
            roomsBlocked: slot.blocked,
            ...(slot.ratePlanCode ? { ratePlanCode: slot.ratePlanCode } : {}),
            // Negotiated amount. Without one, the rate plan sets the price.
            ...(slot.amount === undefined ? {} : { amount: slot.amount }),
          })),
        },
      });

      return reply.code(201).send(toBlock(raw));
    },
  );

  app.patch(
    '/v1/blocks/:blockId',
    {
      schema: {
        tags: ['blocks'],
        summary: 'Update a block — name, status, cutoff',
        params: BlockIdParams,
        body: UpdateBlockBody,
        response: { 200: Block, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const { name, status, cutoffDate, rates } = request.body;

      const raw = await operaRequest<OperaBlockPayload>(
        `/blk/v1/hotels/${hotel}/blocks/${encodeURIComponent(request.params.blockId)}`,
        {
          method: 'PATCH',
          hotelId: hotel,
          body: {
            ...(name ? { blockName: name } : {}),
            ...(status ? { blockStatus: status } : {}),
            ...(cutoffDate ? { cutoffDate } : {}),
            ...(rates
              ? {
                  rates: rates.map((row) => ({
                    roomType: row.roomTypeCode,
                    ...(row.ratePlanCode ? { ratePlanCode: row.ratePlanCode } : {}),
                    amount: row.amount,
                  })),
                }
              : {}),
          },
        },
      );

      return toBlock(raw);
    },
  );
};
