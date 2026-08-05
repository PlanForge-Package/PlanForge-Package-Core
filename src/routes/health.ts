import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Service health',
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            service: Type.String(),
            environment: Type.String(),
            uptimeSeconds: Type.Number(),
          }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'planforge-core',
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
};
