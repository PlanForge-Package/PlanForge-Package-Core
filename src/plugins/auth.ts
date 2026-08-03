import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

/**
 * 내부 서비스 인증. BE 만 Core 를 호출한다는 전제이므로 공유 API 키로 충분하다.
 * `/health` 와 문서 경로는 예외.
 */
const PUBLIC_PREFIXES = ['/health', '/docs', '/openapi.json'];

const authPlugin: FastifyPluginAsync = async (app) => {
  if (!env.serviceApiKey) {
    app.log.warn('SERVICE_API_KEY 가 비어 있어 Core API 인증이 비활성화되었습니다.');
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
