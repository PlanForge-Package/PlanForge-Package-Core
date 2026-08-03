import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import {
  toBlock,
  type OperaBlockListPayload,
  type OperaBlockPayload,
} from '../opera/block-mapper.js';
import { operaRequest } from '../opera/client.js';
import {
  toReservation,
  type OperaReservationListPayload,
} from '../opera/reservation-mapper.js';
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
 * 단체 블록.
 *
 * 블록은 재고를 미리 잡아 두는 장치라 일반 예약과 같은 재고 풀을 건드린다.
 * PlanForge 가 따로 계산하면 일반 판매와 단체 할당이 서로 다른 재고를 보게 되어
 * 오버북이 난다. 그래서 여기서도 OPERA 에 맡긴다.
 */
export const blockRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/blocks',
    {
      schema: {
        tags: ['blocks'],
        summary: '단체 블록 목록',
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
        summary: '블록 단건 — 일자·객실 타입별 할당 포함',
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
        summary: '룸리스트 — 이 블록에서 빠져나간 예약',
        params: BlockIdParams,
        response: { 200: ReservationListResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;

      // 블록을 먼저 읽는 이유는 코드가 필요해서다. OPERA 예약 조회는 블록 ID 가
      // 아니라 블록 코드로 건다. 없는 블록이면 여기서 404 가 난다.
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
        summary: '블록 생성 — 재고 확보는 OPERA 가 판단합니다',
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
        summary: '블록 수정 — 이름·상태·컷오프',
        params: BlockIdParams,
        body: UpdateBlockBody,
        response: { 200: Block, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const { name, status, cutoffDate } = request.body;

      const raw = await operaRequest<OperaBlockPayload>(
        `/blk/v1/hotels/${hotel}/blocks/${encodeURIComponent(request.params.blockId)}`,
        {
          method: 'PATCH',
          hotelId: hotel,
          body: {
            ...(name ? { blockName: name } : {}),
            ...(status ? { blockStatus: status } : {}),
            ...(cutoffDate ? { cutoffDate } : {}),
          },
        },
      );

      return toBlock(raw);
    },
  );
};
