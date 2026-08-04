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
 * Business date.
 *
 * PlanForge does not compute it. Only OPERA knows when the night audit ran, and
 * that value decides which day revenue and occupancy land on. Substituting the
 * calendar date shifts postings made after midnight but before close by a day.
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
