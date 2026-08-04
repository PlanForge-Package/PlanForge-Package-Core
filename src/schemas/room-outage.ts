import { Type, type Static } from '@sinclair/typebox';
import { DateString, HotelIdQuery } from './common.js';

/**
 * 객실을 판매에서 빼는 두 가지 방식.
 *
 * OPERA 는 이 둘을 구분한다. 이름이 비슷해 같은 것으로 보기 쉽지만 실적 집계가
 * 달라진다.
 *
 * - `OutOfOrder` — 물리적으로 쓸 수 없는 객실(누수·공사). **재고에서 빠진다.**
 *   판매 가능 수도, 점유율의 분모도 함께 줄어든다. 그래서 객실 20개 중 2개가
 *   OOO 이고 15개가 팔렸으면 점유율은 15/18 이다.
 * - `OutOfService` — 팔지 않을 뿐 객실은 멀쩡하다(대기 객실, 경미한 정비).
 *   **재고에는 남는다.** 분모는 20 그대로라 점유율은 15/20 이다.
 *
 * 정비 기간을 OOO 로 잡으면 점유율이 실제보다 높게, OOS 로 잡으면 낮게
 * 나온다. 어느 쪽을 쓸지는 호텔의 판단이므로 선택하게 두고 강제하지 않는다.
 */
export const RoomOutageKind = Type.Union(
  [Type.Literal('OutOfOrder'), Type.Literal('OutOfService')],
  {
    description: '재고 제외(OutOfOrder) / 판매 중지(OutOfService)',
  },
);

export const RoomOutage = Type.Object({
  outageId: Type.String(),
  hotelId: Type.String(),
  roomNumber: Type.String(),
  roomType: Type.Optional(Type.String()),
  kind: RoomOutageKind,
  /** 사용 불가 시작일(포함). */
  startDate: DateString,
  /** 사용 불가 종료일(포함). 이 날까지 팔 수 없고 다음 날부터 판매가 재개된다. */
  endDate: DateString,
  reason: Type.String(),
  /** 기간이 끝나면 되돌릴 하우스키핑 상태. 대개 청소가 필요하므로 Dirty 다. */
  returnStatus: Type.String(),
});

export const RoomOutageListQuery = Type.Object({
  hotelId: HotelIdQuery,
  roomNumber: Type.Optional(Type.String({ minLength: 1 })),
  /** 이 날짜에 걸쳐 있는 건만 본다. 생략하면 전부 본다. */
  onDate: Type.Optional(DateString),
});

export const RoomOutageListResponse = Type.Object({
  hotelId: Type.String(),
  items: Type.Array(RoomOutage),
});

export const CreateRoomOutageBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  roomNumber: Type.String({ minLength: 1 }),
  kind: RoomOutageKind,
  startDate: DateString,
  endDate: DateString,
  // 사유 없는 사용 불가는 나중에 아무도 해제하지 못한다. 필수로 받는다.
  reason: Type.String({ minLength: 1, maxLength: 200 }),
  returnStatus: Type.Optional(Type.String({ minLength: 1 })),
});

export const RoomOutageParams = Type.Object({
  outageId: Type.String({ minLength: 1 }),
});

export const ReleaseRoomOutageBody = Type.Object({
  hotelId: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

export type RoomOutageKind = Static<typeof RoomOutageKind>;
export type RoomOutage = Static<typeof RoomOutage>;
export type CreateRoomOutageBody = Static<typeof CreateRoomOutageBody>;
