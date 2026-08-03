import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { OperaApiError, OperaAuthError } from './opera/errors.js';
import authPlugin from './plugins/auth.js';
import { availabilityRoutes } from './routes/availability.js';
import { healthRoutes } from './routes/health.js';
import { reservationRoutes } from './routes/reservations.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.logLevel,
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.corsOrigin });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PlanForge Core API',
        description: 'Oracle OPERA Cloud(OHIP) 연동 게이트웨이',
        version: '0.0.0',
      },
      servers: [{ url: `http://localhost:${env.port}`, description: 'local' }],
      components: {
        securitySchemes: {
          serviceApiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
        },
      },
      security: [{ serviceApiKey: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(availabilityRoutes);
  await app.register(reservationRoutes);

  // OPERA 오류를 게이트웨이 표준 응답으로 변환한다.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OperaApiError) {
      request.log.warn({ status: error.status, body: error.body }, 'OPERA API error');
      const statusCode = error.status === 404 ? 404 : 502;
      return reply.code(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Bad Gateway',
        message: error.message,
      });
    }

    if (error instanceof OperaAuthError) {
      request.log.error({ err: error }, 'OPERA auth error');
      return reply.code(502).send({
        statusCode: 502,
        error: 'Bad Gateway',
        message: 'OPERA 인증에 실패했습니다.',
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    const fastifyError = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = fastifyError.statusCode ?? 500;
    return reply.code(statusCode).send({
      statusCode,
      error: fastifyError.name || 'Internal Server Error',
      message:
        statusCode >= 500 ? '서버 오류가 발생했습니다.' : (fastifyError.message ?? 'Bad Request'),
    });
  });

  return app;
}
