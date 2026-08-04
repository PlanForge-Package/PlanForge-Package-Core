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
 * Transaction codes.
 *
 * The basis for the closing journal — whether an amount is room or F&B revenue,
 * and how tax applies, comes from this configuration. The ledger lives in OPERA,
 * so its classification does too.
 *
 * Paths follow OHIP conventions but are a guess (`/csh/v1/hotels/{hotelId}/transactionCodes`).
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

/** Declares only the parts of the OHIP response we actually use. */
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
