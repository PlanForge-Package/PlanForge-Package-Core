import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const OUTAGES = '/hsk/v1/hotels/SAND01/outOfOrders';
const ROOMS = '/hsk/v1/hotels/SAND01/rooms';
const AVAILABILITY = '/par/v1/hotels/SAND01/availability';

interface OutageRow {
  outageId: string;
  roomId: string;
  roomType?: string;
  kind: string;
  startDate: string;
  endDate: string;
  reason: string;
  returnStatus: string;
}

function createOutage(body: Record<string, unknown>): OutageRow {
  return mockOperaRequest<OutageRow>(OUTAGES, { method: 'POST', hotelId: 'SAND01', body });
}

function listOutages(query: Record<string, unknown> = {}): OutageRow[] {
  return mockOperaRequest<{ outOfOrders: OutageRow[] }>(OUTAGES, { hotelId: 'SAND01', query })
    .outOfOrders;
}

function availableFor(roomType: string, arrival: string, departure: string): number {
  const result = mockOperaRequest<{ roomStays: Array<{ roomType: string; available: number }> }>(
    AVAILABILITY,
    { hotelId: 'SAND01', query: { startDate: arrival, endDate: departure, roomType } },
  );
  return result.roomStays[0]?.available ?? 0;
}

function roomStatus(roomId: string): string {
  const result = mockOperaRequest<{ rooms: Array<{ roomId: string; roomStatus: string }> }>(ROOMS, {
    hotelId: 'SAND01',
  });
  return result.rooms.find((room) => room.roomId === roomId)?.roomStatus ?? '';
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 사용 불가 객실', () => {
  it('시드에 1502 의 공사 기간이 근거로 남아 있다', () => {
    const items = listOutages();
    expect(items).toHaveLength(1);
    expect(items[0]?.roomId).toBe('1502');
    expect(items[0]?.kind).toBe('OutOfOrder');
    expect(roomStatus('1502')).toBe('OutOfOrder');
  });

  it('등록하면 그 기간의 판매 가능 수가 줄어든다', () => {
    const before = availableFor('STDT', day(20), day(21));

    createOutage({
      roomId: '1101',
      kind: 'OutOfService',
      startDate: day(20),
      endDate: day(20),
      reason: '카펫 교체',
    });

    expect(availableFor('STDT', day(20), day(21))).toBe(before - 1);
  });

  it('기간이 겹치지 않는 날짜는 그대로 판다', () => {
    const before = availableFor('STDT', day(25), day(26));

    createOutage({
      roomId: '1101',
      kind: 'OutOfService',
      startDate: day(20),
      endDate: day(21),
      reason: '카펫 교체',
    });

    expect(availableFor('STDT', day(25), day(26))).toBe(before);
  });

  it('종료일 당일은 팔지 못하고 다음 날부터 판다', () => {
    const before = availableFor('STDT', day(20), day(21));
    createOutage({
      roomId: '1101',
      kind: 'OutOfService',
      startDate: day(18),
      endDate: day(20),
      reason: '도색',
    });

    // 20일 밤은 막히고
    expect(availableFor('STDT', day(20), day(21))).toBe(before - 1);
    // 21일 밤은 다시 팔린다
    expect(availableFor('STDT', day(21), day(22))).toBe(before);
  });

  it('오늘을 포함하면 하우스키핑 상태도 지금 바꾼다', () => {
    createOutage({
      roomId: '1101',
      kind: 'OutOfOrder',
      startDate: day(0),
      endDate: day(2),
      reason: '누수',
    });

    expect(roomStatus('1101')).toBe('OutOfOrder');
  });

  it('미래 기간은 오늘의 객실 상태를 건드리지 않는다', () => {
    createOutage({
      roomId: '1101',
      kind: 'OutOfOrder',
      startDate: day(10),
      endDate: day(12),
      reason: '예정된 공사',
    });

    expect(roomStatus('1101')).toBe('Clean');
  });

  it('해제하면 복귀 상태로 되돌리고 다시 판다', () => {
    const before = availableFor('STDT', day(0), day(1));
    const outage = createOutage({
      roomId: '1101',
      kind: 'OutOfOrder',
      startDate: day(0),
      endDate: day(2),
      reason: '누수',
      returnStatus: 'Dirty',
    });

    mockOperaRequest(`${OUTAGES}/${outage.outageId}`, { method: 'DELETE', hotelId: 'SAND01' });

    // 청소 여부를 알 수 없으므로 Clean 이 아니라 Dirty 로 돌아온다.
    expect(roomStatus('1101')).toBe('Dirty');
    expect(availableFor('STDT', day(0), day(1))).toBe(before);
    expect(listOutages().some((row) => row.outageId === outage.outageId)).toBe(false);
  });

  it('없는 객실은 거절한다', () => {
    expect(() =>
      createOutage({
        roomId: '9999',
        kind: 'OutOfOrder',
        startDate: day(1),
        endDate: day(2),
        reason: '누수',
      }),
    ).toThrow(OperaApiError);
  });

  it('종료일이 시작일보다 앞서면 거절한다', () => {
    expect(() =>
      createOutage({
        roomId: '1101',
        kind: 'OutOfOrder',
        startDate: day(5),
        endDate: day(3),
        reason: '누수',
      }),
    ).toThrowError(/종료일/);
  });

  it('이미 지난 기간은 거절한다', () => {
    expect(() =>
      createOutage({
        roomId: '1101',
        kind: 'OutOfOrder',
        startDate: day(-10),
        endDate: day(-5),
        reason: '지난 공사',
      }),
    ).toThrowError(/지난 기간/);
  });

  it('같은 객실의 기간이 겹치면 거절한다', () => {
    createOutage({
      roomId: '1101',
      kind: 'OutOfOrder',
      startDate: day(3),
      endDate: day(6),
      reason: '공사',
    });

    expect(() =>
      createOutage({
        roomId: '1101',
        kind: 'OutOfService',
        startDate: day(5),
        endDate: day(8),
        reason: '추가 공사',
      }),
    ).toThrowError(/이미 사용 불가/);
  });

  it('그 기간에 배정된 예약이 있으면 거절한다', () => {
    const created = mockOperaRequest<{ reservationId: string }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: day(4), departureDate: day(6), roomType: 'STDT' },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    mockOperaRequest(`/rsv/v1/hotels/SAND01/reservations/${created.reservationId}`, {
      method: 'PATCH',
      hotelId: 'SAND01',
      body: { roomStay: { roomId: '1101' } },
    });

    expect(() =>
      createOutage({
        roomId: '1101',
        kind: 'OutOfOrder',
        startDate: day(5),
        endDate: day(7),
        reason: '누수',
      }),
    ).toThrowError(/배정/);
  });

  it('재실 중인 객실을 오늘부터 빼려 하면 거절한다', () => {
    expect(() =>
      createOutage({
        roomId: '1203',
        kind: 'OutOfOrder',
        startDate: day(0),
        endDate: day(2),
        reason: '누수',
      }),
    ).toThrowError(/재실/);
  });

  it('재실 중이어도 손님이 나간 뒤 기간은 받는다', () => {
    const outage = createOutage({
      roomId: '1203',
      kind: 'OutOfOrder',
      startDate: day(20),
      endDate: day(22),
      reason: '예정된 공사',
    });

    expect(outage.outageId).toBeTruthy();
  });

  it('알 수 없는 구분은 거절한다', () => {
    expect(() =>
      createOutage({
        roomId: '1101',
        kind: 'Broken',
        startDate: day(1),
        endDate: day(2),
        reason: '누수',
      }),
    ).toThrowError(/사용 불가 구분/);
  });

  it('날짜로 걸러 본다', () => {
    createOutage({
      roomId: '1101',
      kind: 'OutOfService',
      startDate: day(10),
      endDate: day(12),
      reason: '도색',
    });

    // 시드 객실 1502 의 공사 기간(-3 ~ +14)도 같은 날에 걸쳐 있다.
    expect(listOutages({ onDate: day(11) }).map((row) => row.roomId)).toEqual(['1502', '1101']);
    expect(listOutages({ onDate: day(11), roomId: '1101' }).map((row) => row.roomId)).toEqual([
      '1101',
    ]);
    expect(listOutages({ onDate: day(30) })).toHaveLength(0);
  });

  it('사용 불가 기간에 걸친 객실은 배정하지 못한다', () => {
    createOutage({
      roomId: '1101',
      kind: 'OutOfOrder',
      startDate: day(4),
      endDate: day(6),
      reason: '누수',
    });

    const created = mockOperaRequest<{ reservationId: string }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: day(5), departureDate: day(7), roomType: 'STDT' },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    expect(() =>
      mockOperaRequest(`/rsv/v1/hotels/SAND01/reservations/${created.reservationId}`, {
        method: 'PATCH',
        hotelId: 'SAND01',
        body: { roomStay: { roomId: '1101' } },
      }),
    ).toThrowError(/사용 불가/);
  });

  it('없는 기록을 해제하려 하면 거절한다', () => {
    expect(() =>
      mockOperaRequest(`${OUTAGES}/OOO-9999`, { method: 'DELETE', hotelId: 'SAND01' }),
    ).toThrow(OperaApiError);
  });
});
