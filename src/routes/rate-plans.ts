import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  CreatePackageBody,
  CreateRatePlanBody,
  CreateSeasonBody,
  DeleteSeasonBody,
  PackageListQuery,
  PackageListResponse,
  PackageParams,
  RatePackage,
  RatePlan,
  RatePlanListQuery,
  RatePlanListResponse,
  RatePlanParams,
  SeasonParams,
  UpdatePackageBody,
  UpdateRatePlanBody,
} from '../schemas/rate-plan.js';

/**
 * 요금 코드와 패키지.
 *
 * 요금은 OPERA 가 정한다 — 시즌·요일·프로모션·수익관리가 얽힌 결과라 우리가
 * 따로 계산하면 실제로 청구되는 금액과 갈린다. 여기서는 그 설정을 읽고 고칠 뿐,
 * 금액을 매기지 않는다.
 *
 * 경로는 OHIP 의 규약을 따른 **추정치**다(`/rtp/v1/hotels/{hotelId}/ratePlans`).
 * 구독 스펙을 받으면 이 파일과 모의 전송 계층만 고치면 되도록 매핑을 밖으로
 * 흘리지 않는다.
 */
export const ratePlanRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/rate-plans',
    {
      schema: {
        tags: ['rates'],
        summary: '요금 코드 목록',
        querystring: RatePlanListQuery,
        response: { 200: RatePlanListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanListPayload>(
        `/rtp/v1/hotels/${hotel}/ratePlans`,
        { hotelId: hotel, query: { status: request.query.status } },
      );

      return { hotelId: hotel, items: (raw.ratePlans ?? []).map((row) => toPlan(row, hotel)) };
    },
  );

  app.get(
    '/v1/rate-plans/:ratePlanCode',
    {
      schema: {
        tags: ['rates'],
        summary: '요금 코드 단건',
        params: RatePlanParams,
        querystring: RatePlanListQuery,
        response: { 200: RatePlan, 400: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanPayload>(
        `/rtp/v1/hotels/${hotel}/ratePlans/${encodeURIComponent(request.params.ratePlanCode)}`,
        { hotelId: hotel },
      );

      return toPlan(raw, hotel);
    },
  );

  app.post(
    '/v1/rate-plans',
    {
      schema: {
        tags: ['rates'],
        summary: '요금 코드 등록 — OPERA 가 기록의 원천입니다',
        body: CreateRatePlanBody,
        response: { 201: RatePlan, 400: ErrorResponse, 409: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { hotelId, currency, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanPayload>(`/rtp/v1/hotels/${hotel}/ratePlans`, {
        method: 'POST',
        hotelId: hotel,
        body: { ...rest, currencyCode: currency ?? 'KRW' },
      });

      return reply.code(201).send(toPlan(raw, hotel));
    },
  );

  app.patch(
    '/v1/rate-plans/:ratePlanCode',
    {
      schema: {
        tags: ['rates'],
        summary: '요금 코드 수정 — 판매 기간·기준 요금·패키지',
        params: RatePlanParams,
        body: UpdateRatePlanBody,
        response: { 200: RatePlan, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanPayload>(
        `/rtp/v1/hotels/${hotel}/ratePlans/${encodeURIComponent(request.params.ratePlanCode)}`,
        { method: 'PATCH', hotelId: hotel, body: rest },
      );

      return toPlan(raw, hotel);
    },
  );

  app.post(
    '/v1/rate-plans/:ratePlanCode/seasons',
    {
      schema: {
        tags: ['rates'],
        summary: '시즌 요금 추가 — 기간·요일로 기준 요금을 덮어씁니다',
        params: RatePlanParams,
        body: CreateSeasonBody,
        response: { 201: RatePlan, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanPayload>(
        `/rtp/v1/hotels/${hotel}/ratePlans/${encodeURIComponent(
          request.params.ratePlanCode,
        )}/seasons`,
        { method: 'POST', hotelId: hotel, body: rest },
      );

      return reply.code(201).send(toPlan(raw, hotel));
    },
  );

  app.delete(
    '/v1/rate-plans/:ratePlanCode/seasons/:seasonId',
    {
      schema: {
        tags: ['rates'],
        summary: '시즌 요금 삭제',
        params: SeasonParams,
        body: DeleteSeasonBody,
        response: { 200: RatePlan, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePlanPayload>(
        `/rtp/v1/hotels/${hotel}/ratePlans/${encodeURIComponent(
          request.params.ratePlanCode,
        )}/seasons/${encodeURIComponent(request.params.seasonId)}`,
        { method: 'DELETE', hotelId: hotel },
      );

      return toPlan(raw, hotel);
    },
  );

  // --- 패키지 ---------------------------------------------------------------

  app.get(
    '/v1/packages',
    {
      schema: {
        tags: ['rates'],
        summary: '패키지 목록',
        querystring: PackageListQuery,
        response: { 200: PackageListResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaPackageListPayload>(`/rtp/v1/hotels/${hotel}/packages`, {
        hotelId: hotel,
      });

      return { hotelId: hotel, items: (raw.packages ?? []).map((row) => toPackage(row, hotel)) };
    },
  );

  app.post(
    '/v1/packages',
    {
      schema: {
        tags: ['rates'],
        summary: '패키지 등록',
        body: CreatePackageBody,
        response: { 201: RatePackage, 400: ErrorResponse, 409: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaPackagePayload>(`/rtp/v1/hotels/${hotel}/packages`, {
        method: 'POST',
        hotelId: hotel,
        body: rest,
      });

      return reply.code(201).send(toPackage(raw, hotel));
    },
  );

  app.patch(
    '/v1/packages/:packageCode',
    {
      schema: {
        tags: ['rates'],
        summary: '패키지 수정',
        params: PackageParams,
        body: UpdatePackageBody,
        response: { 200: RatePackage, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaPackagePayload>(
        `/rtp/v1/hotels/${hotel}/packages/${encodeURIComponent(request.params.packageCode)}`,
        { method: 'PATCH', hotelId: hotel, body: rest },
      );

      return toPackage(raw, hotel);
    },
  );
};

function toPlan(raw: OperaRatePlanPayload, fallbackHotelId: string): RatePlan {
  return {
    ratePlanCode: raw.ratePlanCode ?? '',
    hotelId: raw.hotelId ?? fallbackHotelId,
    name: raw.name ?? raw.ratePlanCode ?? '',
    ...(raw.description ? { description: raw.description } : {}),
    currency: raw.currencyCode ?? 'KRW',
    marketCode: raw.marketCode ?? 'TRANSIENT',
    sellStartDate: raw.sellStartDate ?? '',
    sellEndDate: raw.sellEndDate ?? '',
    baseAmounts: raw.baseAmounts ?? {},
    seasons: (raw.seasons ?? []).map((season) => ({
      seasonId: season.seasonId ?? '',
      name: season.name ?? '',
      startDate: season.startDate ?? '',
      endDate: season.endDate ?? '',
      ...(season.daysOfWeek?.length ? { daysOfWeek: season.daysOfWeek } : {}),
      amounts: season.amounts ?? {},
    })),
    packageCodes: raw.packageCodes ?? [],
    status: raw.status ?? 'Active',
  };
}

function toPackage(raw: OperaPackagePayload, fallbackHotelId: string): RatePackage {
  return {
    packageCode: raw.packageCode ?? '',
    hotelId: raw.hotelId ?? fallbackHotelId,
    name: raw.name ?? raw.packageCode ?? '',
    amount: raw.amount ?? 0,
    calculation: raw.calculation ?? 'PerNight',
    transactionCode: raw.transactionCode ?? '',
    includedInRate: Boolean(raw.includedInRate),
  };
}

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
interface OperaRatePlanPayload {
  ratePlanCode?: string;
  hotelId?: string;
  name?: string;
  description?: string;
  currencyCode?: string;
  marketCode?: string;
  sellStartDate?: string;
  sellEndDate?: string;
  baseAmounts?: Record<string, number>;
  seasons?: Array<{
    seasonId?: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    daysOfWeek?: number[];
    amounts?: Record<string, number>;
  }>;
  packageCodes?: string[];
  status?: string;
}

interface OperaRatePlanListPayload {
  ratePlans?: OperaRatePlanPayload[];
}

interface OperaPackagePayload {
  packageCode?: string;
  hotelId?: string;
  name?: string;
  amount?: number;
  calculation?: string;
  transactionCode?: string;
  includedInRate?: boolean;
}

interface OperaPackageListPayload {
  packages?: OperaPackagePayload[];
}
