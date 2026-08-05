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
 * Guest profiles.
 *
 * Read and merge only. Names and contact details are better edited in OPERA, and
 * preferences and internal notes belong to PlanForge, so there is nothing to send.
 *
 * Merging is delegated because merging locally leaves two profiles in OPERA, and
 * the next sync brings the deleted one back.
 */
export const profileRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/profiles/:profileId',
    {
      schema: {
        tags: ['profiles'],
        summary: 'One profile',
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
        summary: 'Merge a duplicate into this profile',
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
