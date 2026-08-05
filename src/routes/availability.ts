import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { AvailabilityQuery, AvailabilityResponse } from '../schemas/availability.js';
import { ErrorResponse } from '../schemas/common.js';

export const availabilityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/availability',
    {
      schema: {
        tags: ['availability'],
        summary: 'Availability over a date range',
        description: 'OPERA Cloud 의 가용 재고를 조회해 PlanForge 표준 형태로 반환합니다.',
        querystring: AvailabilityQuery,
        response: {
          200: AvailabilityResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { hotelId, arrivalDate, departureDate, adults, children, roomTypeCode } = request.query;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaAvailabilityPayload>(
        `/par/v1/hotels/${hotel}/availability`,
        {
          hotelId: hotel,
          query: {
            startDate: arrivalDate,
            endDate: departureDate,
            adults,
            children,
            roomType: roomTypeCode,
          },
        },
      );

      return {
        hotelId: hotel,
        arrivalDate,
        departureDate,
        items: (raw.roomStays ?? []).map((stay) => ({
          roomTypeCode: stay.roomType ?? '',
          roomTypeName: stay.roomTypeName,
          availableRooms: stay.available ?? 0,
          ratePlanCode: stay.ratePlanCode,
          amount: stay.total?.amount,
          currency: stay.total?.currencyCode,
        })),
      };
    },
  );
};

/** Declares only the parts of the OHIP response we actually use. */
interface OperaAvailabilityPayload {
  roomStays?: Array<{
    roomType?: string;
    roomTypeName?: string;
    available?: number;
    ratePlanCode?: string;
    total?: { amount?: number; currencyCode?: string };
  }>;
}
