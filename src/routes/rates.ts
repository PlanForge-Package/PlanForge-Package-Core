import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import { RateQuery, RateResponse } from '../schemas/rate.js';

/**
 * Rate quotes.
 *
 * We ask OPERA instead of computing. Rates come out of seasons, weekdays,
 * promotions, negotiated deals and revenue management, so our own version would
 * diverge from what is actually charged.
 */
export const rateRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/rates',
    {
      schema: {
        tags: ['rates'],
        summary: '기간별 요금 조회',
        querystring: RateQuery,
        response: { 200: RateResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const { hotelId, arrivalDate, departureDate, roomTypeCode, ratePlanCode, adults } =
        request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePayload>(`/rtp/v1/hotels/${hotel}/rates`, {
        hotelId: hotel,
        query: {
          startDate: arrivalDate,
          endDate: departureDate,
          roomType: roomTypeCode,
          ratePlanCode,
          adults,
        },
      });

      return {
        hotelId: hotel,
        arrivalDate,
        departureDate,
        nights: nightsBetween(arrivalDate, departureDate),
        offers: (raw.ratePlans ?? []).map((plan) => ({
          ratePlanCode: plan.ratePlanCode ?? '',
          ratePlanName: plan.ratePlanName,
          roomTypeCode: plan.roomType ?? '',
          roomTypeName: plan.roomTypeName,
          currency: plan.currencyCode ?? plan.total?.currencyCode ?? 'KRW',
          nightlyRates: (plan.nightlyRates ?? []).map((night) => ({
            date: night.date ?? '',
            amount: night.amount ?? 0,
            packageAmount: night.packageAmount ?? 0,
          })),
          packages: (plan.packages ?? []).map((pkg) => ({
            packageCode: pkg.packageCode ?? '',
            name: pkg.name ?? '',
            amount: pkg.amount ?? 0,
            calculation: pkg.calculation ?? 'PerNight',
            includedInRate: Boolean(pkg.includedInRate),
          })),
          totalAmount: plan.total?.amount ?? 0,
        })),
      };
    },
  );
};

function nightsBetween(arrival: string, departure: string): number {
  const from = Date.parse(`${arrival}T00:00:00Z`);
  const to = Date.parse(`${departure}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Declares only the parts of the OHIP response we actually use. */
interface OperaRatePayload {
  ratePlans?: Array<{
    ratePlanCode?: string;
    ratePlanName?: string;
    roomType?: string;
    roomTypeName?: string;
    currencyCode?: string;
    nightlyRates?: Array<{ date?: string; amount?: number; packageAmount?: number }>;
    packages?: Array<{
      packageCode?: string;
      name?: string;
      amount?: number;
      calculation?: string;
      includedInRate?: boolean;
    }>;
    total?: { amount?: number; currencyCode?: string };
  }>;
}
