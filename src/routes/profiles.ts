import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import { MergeProfileBody, OperaProfile, ProfileIdParams } from '../schemas/profile.js';

interface OperaProfilePayload {
  profileId?: string;
  profileIdList?: Array<{ id?: string }>;
  givenName?: string;
  surname?: string;
  email?: string;
  mergedIntoId?: string;
}

function toProfile(raw: OperaProfilePayload): OperaProfile {
  return {
    profileId: raw.profileIdList?.[0]?.id ?? raw.profileId ?? '',
    firstName: raw.givenName,
    lastName: raw.surname,
    email: raw.email,
    mergedIntoId: raw.mergedIntoId,
  };
}

/**
 * 게스트 프로필.
 *
 * 조회와 병합만 연다. 이름·연락처 수정은 OPERA 화면에서 하는 편이 낫고, 선호
 * 사항·내부 메모는 PlanForge 가 소유하므로 여기로 보낼 것이 없다.
 *
 * 병합을 위임하는 이유: 로컬에서만 합치면 OPERA 에는 여전히 프로필이 둘이고,
 * 다음 동기화가 지운 쪽을 되살린다.
 */
export const profileRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/profiles/:profileId',
    {
      schema: {
        tags: ['profiles'],
        summary: '프로필 단건',
        params: ProfileIdParams,
        response: { 200: OperaProfile, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaProfilePayload>(
        `/crm/v1/profiles/${encodeURIComponent(request.params.profileId)}`,
        { hotelId: hotel },
      );
      return toProfile(raw);
    },
  );

  app.post(
    '/v1/profiles/:profileId/merge',
    {
      schema: {
        tags: ['profiles'],
        summary: '중복 병합 — 이 프로필을 대상으로 합칩니다',
        params: ProfileIdParams,
        body: MergeProfileBody,
        response: { 200: OperaProfile, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaProfilePayload>(
        `/crm/v1/profiles/${encodeURIComponent(request.params.profileId)}/merge`,
        {
          method: 'POST',
          hotelId: hotel,
          body: { targetProfileId: request.body.targetProfileId },
        },
      );
      return toProfile(raw);
    },
  );
};
