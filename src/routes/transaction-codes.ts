import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  CreateTransactionCodeBody,
  TransactionCode,
  TransactionCodeListQuery,
  TransactionCodeListResponse,
  TransactionCodeParams,
  UpdateTransactionCodeBody,
} from '../schemas/transaction-code.js';

/**
 * 거래 코드.
 *
 * 회계 분개의 기준이다 — 올라간 금액이 객실 매출인지 식음 매출인지, 세금이
 * 어떻게 붙는지가 이 설정에 달려 있다. 원장이 OPERA 에 있으니 그 분류도
 * OPERA 가 원천이다.
 *
 * 경로는 OHIP 규약을 따른 **추정치**다(`/csh/v1/hotels/{hotelId}/transactionCodes`).
 */
export const transactionCodeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/transaction-codes',
    {
      schema: {
        tags: ['cashiering'],
        summary: '거래 코드 목록 — 매출 그룹과 세율',
        querystring: TransactionCodeListQuery,
        response: { 200: TransactionCodeListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaTransactionCodeListPayload>(
        `/csh/v1/hotels/${hotel}/transactionCodes`,
        { hotelId: hotel, query: { includeInactive: request.query.includeInactive } },
      );

      return {
        hotelId: hotel,
        items: (raw.transactionCodes ?? []).map((row) => toCode(row, hotel)),
      };
    },
  );

  app.post(
    '/v1/transaction-codes',
    {
      schema: {
        tags: ['cashiering'],
        summary: '거래 코드 등록 — OPERA 가 기록의 원천입니다',
        body: CreateTransactionCodeBody,
        response: {
          201: TransactionCode,
          400: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaTransactionCodePayload>(
        `/csh/v1/hotels/${hotel}/transactionCodes`,
        { method: 'POST', hotelId: hotel, body: rest },
      );

      return reply.code(201).send(toCode(raw, hotel));
    },
  );

  app.patch(
    '/v1/transaction-codes/:transactionCode',
    {
      schema: {
        tags: ['cashiering'],
        summary: '거래 코드 수정 — 세율·매출 그룹·사용 중지',
        params: TransactionCodeParams,
        body: UpdateTransactionCodeBody,
        response: {
          200: TransactionCode,
          400: ErrorResponse,
          404: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaTransactionCodePayload>(
        `/csh/v1/hotels/${hotel}/transactionCodes/${encodeURIComponent(
          request.params.transactionCode,
        )}`,
        { method: 'PATCH', hotelId: hotel, body: rest },
      );

      return toCode(raw, hotel);
    },
  );
};

function toCode(raw: OperaTransactionCodePayload, fallbackHotelId: string): TransactionCode {
  return {
    transactionCode: raw.transactionCode ?? '',
    hotelId: raw.hotelId ?? fallbackHotelId,
    name: raw.name ?? raw.transactionCode ?? '',
    group: raw.group ?? 'Other',
    vatRate: raw.vatRate ?? 0,
    serviceChargeRate: raw.serviceChargeRate ?? 0,
    taxInclusive: raw.taxInclusive ?? true,
    active: raw.active ?? true,
  };
}

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
interface OperaTransactionCodePayload {
  transactionCode?: string;
  hotelId?: string;
  name?: string;
  group?: string;
  vatRate?: number;
  serviceChargeRate?: number;
  taxInclusive?: boolean;
  active?: boolean;
}

interface OperaTransactionCodeListPayload {
  transactionCodes?: OperaTransactionCodePayload[];
}
