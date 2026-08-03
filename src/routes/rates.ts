import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import { RateQuery, RateResponse } from '../schemas/rate.js';

/**
 * 요금 조회.
 *
 * 계산하지 않고 OPERA 에 묻는다. 요금은 시즌·요일·프로모션·협약가·수익관리가
 * 얽힌 결과라, 자체 구현하면 OPERA 가 실제로 청구하는 금액과 갈린다.
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
      const { hotelId, arrivalDate, departureDate, roomTypeCode, ratePlanCode } = request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaRatePayload>(`/rtp/v1/hotels/${hotel}/rates`, {
        hotelId: hotel,
        query: {
          startDate: arrivalDate,
          endDate: departureDate,
          roomType: roomTypeCode,
          ratePlanCode,
        },
      });

      return {
        hotelId: hotel,
        arrivalDate,
        departureDate,
        nights: nightsBetween(arrivalDate, departureDate),
        offers: (raw.ratePlans ?? []).map((plan) => ({
          ratePlanCode: plan.ratePlanCode ?? '',
          roomTypeCode: plan.roomType ?? '',
          roomTypeName: plan.roomTypeName,
          currency: plan.currencyCode ?? plan.total?.currencyCode ?? 'KRW',
          nightlyRates: (plan.nightlyRates ?? []).map((night) => ({
            date: night.date ?? '',
            amount: night.amount ?? 0,
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

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
interface OperaRatePayload {
  ratePlans?: Array<{
    ratePlanCode?: string;
    roomType?: string;
    roomTypeName?: string;
    currencyCode?: string;
    nightlyRates?: Array<{ date?: string; amount?: number }>;
    total?: { amount?: number; currencyCode?: string };
  }>;
}
