import { Type, type Static } from '@sinclair/typebox';
import { HotelIdQuery } from './common.js';

/** OPERA room status values. */
export const OperaRoomStatus = Type.Union(
  [
    Type.Literal('Clean'),
    Type.Literal('Dirty'),
    Type.Literal('Inspected'),
    Type.Literal('OutOfOrder'),
    Type.Literal('OutOfService'),
  ],
  { description: 'OPERA 하우스키핑 상태' },
);

export const RoomStatusParams = Type.Object({
  roomNumber: Type.String({ minLength: 1 }),
});

export const UpdateRoomStatusBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  status: OperaRoomStatus,
  /** Maintenance reason, recorded when setting OutOfOrder. */
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

export const RoomStatusResponse = Type.Object({
  hotelId: Type.String(),
  roomNumber: Type.String(),
  status: OperaRoomStatus,
  occupied: Type.Optional(Type.Boolean()),
});

export const RoomStatusListQuery = Type.Object({
  hotelId: HotelIdQuery,
  status: Type.Optional(OperaRoomStatus),
});

export const RoomStatusListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(RoomStatusResponse),
});

export type OperaRoomStatus = Static<typeof OperaRoomStatus>;
export type UpdateRoomStatusBody = Static<typeof UpdateRoomStatusBody>;
export type RoomStatusResponse = Static<typeof RoomStatusResponse>;
