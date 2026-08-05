import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

/**
 * Internal service auth. Only the BE calls Core, so a shared API key is enough.
 * `/health` and the docs paths are exempt.
 */
const PUBLIC_PREFIXES = ['/health', '/docs', '/openapi.json'];

const authPlugin: FastifyPluginAsync = async (app) => {
  if (!env.serviceApiKey) {
    app.log.warn('SERVICE_API_KEY is empty, so Core API authentication is disabled.');
    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }

    if (request.headers['x-api-key'] !== env.serviceApiKey) {
      await reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: '유효한 x-api-key 헤더가 필요합니다.',
      });
    }
  });
};

export default fp(authPlugin, { name: 'planforge-auth' });
