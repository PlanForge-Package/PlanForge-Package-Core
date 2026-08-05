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
 * Rate plans and packages.
 *
 * OPERA sets prices — seasons, weekdays, promotions and revenue management all
 * feed in, and computing them ourselves would diverge from what is actually
 * charged. Here we only read and edit that configuration.
 *
 * Paths follow OHIP conventions but are a guess (`/rtp/v1/hotels/{hotelId}/ratePlans`).
 * The mapping stays inside this file so that only it and the mock transport need
 * fixing when the spec arrives.
 */
export const ratePlanRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/rate-plans',
    {
      schema: {
        tags: ['rates'],
        summary: 'Rate codes',
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
        summary: 'One rate code',
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
        summary: 'Create a rate code — OPERA is the system of record',
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
        summary: 'Update a rate code — selling period, base rates, packages',
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
        summary: 'Add a season — overrides the base rate by date range and weekday',
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
        summary: 'Remove a season',
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

  // --- Packages -----------------------------------------------------------

  app.get(
    '/v1/packages',
    {
      schema: {
        tags: ['rates'],
        summary: 'Packages',
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
        summary: 'Create a package',
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
        summary: 'Update a package',
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

/** Declares only the parts of the OHIP response we actually use. */
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
