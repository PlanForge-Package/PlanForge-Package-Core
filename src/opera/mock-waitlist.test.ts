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
}

/** 스위트는 재고가 4개뿐이라 매진을 만들기 쉽다. */
function book(roomType = 'SUIT', waitlist = false, arrival = day(30), departure = day(31)): Row {
  return mockOperaRequest<Row>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: {
        arrivalDate: arrival,
        departureDate: departure,
        roomType,
        ...(waitlist ? { waitlist: true } : {}),
      },
      guest: { givenName: 'A', surname: 'B' },
    },
  });
}

function available(roomType: string, arrival = day(30), departure = day(31)): number {
  const result = mockOperaRequest<{ roomStays: Array<{ available: number }> }>(
    '/par/v1/hotels/SAND01/availability',
    { hotelId: 'SAND01', query: { startDate: arrival, endDate: departure, roomType } },
  );
  return result.roomStays[0]?.available ?? 0;
}

function confirm(id: string): Row {
  return mockOperaRequest<Row>(`${RESERVATIONS}/${id}/confirmWaitlist`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {},
  });
}

function fillSuites(): Row[] {
  return Array.from({ length: 4 }, () => book('SUIT'));
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 재고 초과 예약', () => {
  /*
   * 안내와 수락이 갈라지면 화면에 "매진" 이라고 떠 있어도 예약이 만들어진다.
   * 재고 판단을 OPERA 에 맡긴 의미가 사라진다.
   */
  it('남은 객실이 없으면 예약을 거절한다', () => {
    fillSuites();
    expect(available('SUIT')).toBe(0);

    expect(() => book('SUIT')).toThrowError(/남은 객실이 없습니다/);
  });

  it('거절 메시지가 대기 방법을 알려 준다', () => {
    fillSuites();
    expect(() => book('SUIT')).toThrowError(/waitlist/);
  });

  it('자리가 있으면 그대로 받는다', () => {
    expect(book('SUIT').reservationStatus).toBe('Reserved');
  });

  it('기간이 겹치지 않으면 재고를 다시 판다', () => {
    fillSuites();
    expect(() => book('SUIT', false, day(40), day(41))).not.toThrow();
  });
});

describe('모의 OPERA — 대기 예약', () => {
  it('매진이어도 대기로 받는다', () => {
    fillSuites();
    expect(book('SUIT', true).reservationStatus).toBe('Waitlisted');
  });

  // 자리를 차지하지 않고 기다리는 것이 대기다.
  it('대기 예약은 재고를 차지하지 않는다', () => {
    const before = available('SUIT');
    book('SUIT', true);

    expect(available('SUIT')).toBe(before);
  });

  it('자리가 나면 확정으로 올린다', () => {
    const filled = fillSuites();
    const waiting = book('SUIT', true);

    // 한 건이 취소되어 자리가 하나 난다.
    mockOperaRequest(`${RESERVATIONS}/${filled[0]!.reservationId}`, {
      method: 'DELETE',
      hotelId: 'SAND01',
    });

    expect(confirm(waiting.reservationId).reservationStatus).toBe('Confirmed');
  });

  /*
   * 대기에 올릴 때 자리가 없었다는 사실은 확정 시점과 무관하다. 그 사이 다른
   * 대기 건이 먼저 확정됐을 수도 있다.
   */
  it('아직 자리가 없으면 확정하지 못한다', () => {
    fillSuites();
    const waiting = book('SUIT', true);

    expect(() => confirm(waiting.reservationId)).toThrowError(/빈 객실이 없습니다/);
  });

  it('확정한 대기는 재고를 차지한다', () => {
    const filled = fillSuites();
    const waiting = book('SUIT', true);
    mockOperaRequest(`${RESERVATIONS}/${filled[0]!.reservationId}`, {
      method: 'DELETE',
      hotelId: 'SAND01',
    });

    expect(available('SUIT')).toBe(1);
    confirm(waiting.reservationId);
    expect(available('SUIT')).toBe(0);
  });

  it('대기가 아닌 예약은 확정 대상이 아니다', () => {
    const normal = book('SUIT');
    expect(() => confirm(normal.reservationId)).toThrowError(/대기 상태가 아닙니다/);
  });

  it('두 번 확정하지 않는다', () => {
    const filled = fillSuites();
    const waiting = book('SUIT', true);
    mockOperaRequest(`${RESERVATIONS}/${filled[0]!.reservationId}`, {
      method: 'DELETE',
      hotelId: 'SAND01',
    });
    confirm(waiting.reservationId);

    expect(() => confirm(waiting.reservationId)).toThrowError(/대기 상태가 아닙니다/);
  });

  it('없는 예약은 거절한다', () => {
    expect(() => confirm('OPERA-0000')).toThrow(OperaApiError);
  });
});

describe('모의 OPERA — 사용 불가 객실과 재고', () => {
  // 공사 중인 객실은 팔 수 없다. 안내와 수락이 같은 계산을 써야 한다.
  it('사용 불가 객실만큼 덜 판다', () => {
    const before = available('SUIT');

    mockOperaRequest('/hsk/v1/hotels/SAND01/outOfOrders', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomId: '1501',
        kind: 'OutOfOrder',
        startDate: day(30),
        endDate: day(30),
        reason: '누수',
      },
    });

    expect(available('SUIT')).toBe(before - 1);
  });
});
