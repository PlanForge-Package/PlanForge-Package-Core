import { Type, type Static } from '@sinclair/typebox';

export const OperaProfile = Type.Object({
  profileId: Type.String(),
  firstName: Type.Optional(Type.String()),
  lastName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  /** 병합되어 다른 프로필로 흡수되었으면 그 대상. */
  mergedIntoId: Type.Optional(Type.String()),
});

export const ProfileIdParams = Type.Object({
  profileId: Type.String({ minLength: 1 }),
});

export const MergeProfileBody = Type.Object({
  /** 남길 프로필. 이쪽으로 합쳐진다. */
  targetProfileId: Type.String({ minLength: 1 }),
});

export type OperaProfile = Static<typeof OperaProfile>;
export type MergeProfileBody = Static<typeof MergeProfileBody>;
