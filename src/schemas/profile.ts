import { Type, type Static } from '@sinclair/typebox';

export const OperaProfile = Type.Object({
  profileId: Type.String(),
  firstName: Type.Optional(Type.String()),
  lastName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  /** Target profile, if this one was merged away. */
  mergedIntoId: Type.Optional(Type.String()),
});

export const ProfileIdParams = Type.Object({
  profileId: Type.String({ minLength: 1 }),
});

export const MergeProfileBody = Type.Object({
  /** Profile to keep. Everything merges into this one. */
  targetProfileId: Type.String({ minLength: 1 }),
});

export type OperaProfile = Static<typeof OperaProfile>;
export type MergeProfileBody = Static<typeof MergeProfileBody>;
