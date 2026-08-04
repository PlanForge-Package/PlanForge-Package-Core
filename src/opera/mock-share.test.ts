import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RESERVATIONS = '/rsv/v1/hotels/SAND01/reservations';

interface Row {
  reservationId: string;
  reservationStatus: string;
  roomStay: { roomId?: string; shareGroupId?: string; roomType: string };
}

function book(roomType = 'STDT', arrival = day(20), departure = day(22), surname = 'Share'): Row {
  return mockOperaRequest<Row>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: { arrivalDate: arrival, departureDate: departure, roomType },
      guest: { givenName: 'A', surname },
    },
  });
}

function share(id: string, withId: string) {
  return mockOperaRequest<{ shareGroupId: string; reservations: Row[] }>(
    `${RESERVATIONS}/${id}/share`,
    { method: 'POST', hotelId: 'SAND01', body: { withReservationId: withId } },
  );
}

function unshare(id: string): Row {
  return mockOperaRequest<Row>(`${RESERVATIONS}/${id}/unshare`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {},
  });
}

function checkIn(id: string, roomId: string): Row {
  return mockOperaRequest<Row>(`${RESERVATIONS}/${id}/checkIn`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: { roomId },
  });
}

function available(roomType: string, arrival = day(20), departure = day(22)): number {
  const result = mockOperaRequest<{ roomStays: Array<{ available: number }> }>(
    '/par/v1/hotels/SAND01/availability',
    { hotelId: 'SAND01', query: { startDate: arrival, endDate: departure, roomType } },
  );
  return result.roomStays[0]?.available ?? 0;
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 객실 공유', () => {
  it('두 예약을 한 묶음으로 만든다', () => {
    const a = book();
    const b = book();

    const result = share(a.reservationId, b.reservationId);

    expect(result.shareGroupId).toMatch(/^SHR-/);
    expect(result.reservations).toHaveLength(2);
    expect(new Set(result.reservations.map((r) => r.roomStay.shareGroupId)).size).toBe(1);
  });

  /*
   * Two reservations, one room. Counting both burns inventory faster than
   * reality and leaves sellable rooms unsold.
   */
  it('공유하면 재고를 하나만 차지한다', () => {
    const before = available('STDT');

    const a = book();
    const b = book();
    expect(available('STDT')).toBe(before - 2);

    share(a.reservationId, b.reservationId);
    expect(available('STDT')).toBe(before - 1);
  });

  it('셋째 예약도 같은 묶음에 붙는다', () => {
    const a = book();
    const b = book();
    const c = book();

    const group = share(a.reservationId, b.reservationId).shareGroupId;
    expect(share(a.reservationId, c.reservationId).shareGroupId).toBe(group);
  });

  it('배정된 객실이 있으면 그 방으로 맞춘다', () => {
    const a = book('STDT', day(0), day(2));
    const b = book('STDT', day(0), day(2));
    checkIn(a.reservationId, '1101');

    const result = share(a.reservationId, b.reservationId);
    expect(result.reservations.every((r) => r.roomStay.roomId === '1101')).toBe(true);
  });

  // A share is two guests in one room with separate folios.
  it('공유 상대가 든 방에는 함께 들어간다', () => {
    const a = book('STDT', day(0), day(2));
    const b = book('STDT', day(0), day(2));
    share(a.reservationId, b.reservationId);
    checkIn(a.reservationId, '1101');

    expect(checkIn(b.reservationId, '1101').reservationStatus).toBe('InHouse');
  });

  it('공유가 아니면 든 방에 들어가지 못한다', () => {
    const a = book('STDT', day(0), day(2));
    const b = book('STDT', day(0), day(2));
    checkIn(a.reservationId, '1101');

    expect(() => checkIn(b.reservationId, '1101')).toThrowError(/사용 중/);
  });
});

describe('모의 OPERA — 공유 거절', () => {
  it('같은 예약끼리는 묶지 않는다', () => {
    const a = book();
    expect(() => share(a.reservationId, a.reservationId)).toThrowError(/같은 예약/);
  });

  it('기간이 겹치지 않으면 묶지 않는다', () => {
    const a = book('STDT', day(20), day(22));
    const b = book('STDT', day(25), day(27));

    expect(() => share(a.reservationId, b.reservationId)).toThrowError(/기간이 겹치지/);
  });

  it('객실 타입이 다르면 묶지 않는다', () => {
    const a = book('STDT');
    const b = book('DLXK');

    expect(() => share(a.reservationId, b.reservationId)).toThrowError(/객실 타입이 다릅니다/);
  });

  it('취소된 예약은 묶지 않는다', () => {
    const a = book();
    const b = book();
    mockOperaRequest(`${RESERVATIONS}/${b.reservationId}`, {
      method: 'DELETE',
      hotelId: 'SAND01',
    });

    expect(() => share(a.reservationId, b.reservationId)).toThrowError(/공유할 수 없습니다/);
  });

  // We cannot decide which one to move.
  it('서로 다른 방에 들어가 있으면 묶지 않는다', () => {
    const a = book('STDT', day(0), day(2));
    const b = book('STDT', day(0), day(2));
    checkIn(a.reservationId, '1101');
    checkIn(b.reservationId, '1102');

    expect(() => share(a.reservationId, b.reservationId)).toThrowError(/서로 다른 객실/);
  });

  it('없는 예약은 거절한다', () => {
    const a = book();
    expect(() => share(a.reservationId, 'OPERA-0000')).toThrow(OperaApiError);
  });
});

describe('모의 OPERA — 공유 해제', () => {
  it('묶음에서 뺀다', () => {
    const a = book();
    const b = book();
    const c = book();
    share(a.reservationId, b.reservationId);
    share(a.reservationId, c.reservationId);

    expect(unshare(a.reservationId).roomStay.shareGroupId).toBeUndefined();
  });

  /*
   * A share marker left on a lone reservation makes it look shared when it is not.
   */
  it('둘뿐이었으면 남은 쪽의 표시도 푼다', () => {
    const a = book();
    const b = book();
    share(a.reservationId, b.reservationId);

    unshare(a.reservationId);

    const remaining = mockOperaRequest<Row>(`${RESERVATIONS}/${b.reservationId}`, {
      hotelId: 'SAND01',
    });
    expect(remaining.roomStay.shareGroupId).toBeUndefined();
  });

  it('해제하면 재고를 다시 각각 차지한다', () => {
    const before = available('STDT');
    const a = book();
    const b = book();
    share(a.reservationId, b.reservationId);
    expect(available('STDT')).toBe(before - 1);

    unshare(a.reservationId);
    expect(available('STDT')).toBe(before - 2);
  });

  it('공유 중이 아니면 해제할 수 없다', () => {
    const a = book();
    expect(() => unshare(a.reservationId)).toThrowError(/공유 중인 예약이 아닙니다/);
  });
});
