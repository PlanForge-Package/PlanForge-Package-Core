import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import { BusinessDate, BusinessDateQuery } from '../schemas/night-audit.js';

interface OperaBusinessDatePayload {
  hotelId?: string;
  businessDate?: string;
  currentDate?: string;
}

/**
 * 영업일.
 *
 * PlanForge 가 자체로 계산하지 않는다. 야간 감사를 언제 돌렸는지는 OPERA 만
 * 알고, 매출과 점유율이 어느 날짜에 붙는지가 그 값으로 정해진다. 우리가 달력
 * 날짜로 대신 쓰면 자정 이후 마감 전에 올린 매출이 하루 밀려 집계된다.
 */
export const nightAuditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/business-date',
    {
      schema: {
        tags: ['night-audit'],
        summary: '호텔 영업일 — OPERA 가 들고 있는 값',
        querystring: BusinessDateQuery,
        response: { 200: BusinessDate, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.query.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaBusinessDatePayload>(
        `/lov/v1/hotels/${hotel}/businessDate`,
        { hotelId: hotel },
      );

      const calendarDate = new Date().toISOString().slice(0, 10);
      return {
        hotelId: raw.hotelId ?? hotel,
        businessDate: raw.businessDate ?? calendarDate,
        calendarDate: raw.currentDate ?? calendarDate,
      };
    },
  );
};
