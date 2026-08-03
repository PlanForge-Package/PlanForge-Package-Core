import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RESERVATIONS = '/rsv/v1/hotels/SAND01/reservations';

function createReservation(arrival: string, departure: string): string {
  const created = mockOperaRequest<{ reservationId: string }>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: { arrivalDate: arrival, departureDate: departure, roomType: 'STDT' },
      guest: { givenName: 'A', surname: 'B' },
    },
  });
  return created.reservationId;
}

function noShow(id: string) {
  return mockOperaRequest<{ reservationStatus: string }>(`${RESERVATIONS}/${id}`, {
    method: 'PATCH',
    hotelId: 'SAND01',
    body: { reservationStatus: 'NoShow' },
  });
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 영업일', () => {
  it('영업일과 달력 날짜를 함께 준다', () => {
    const result = mockOperaRequest<{ businessDate: string; currentDate: string }>(
      '/lov/v1/hotels/SAND01/businessDate',
      { hotelId: 'SAND01' },
    );
    expect(result.businessDate).toBe(day(0));
    expect(result.currentDate).toBe(day(0));
  });
});

describe('모의 OPERA — 노쇼', () => {
  it('도착일이 지난 예약은 노쇼로 바꾼다', () => {
    const id = createReservation(day(-1), day(1));
    expect(noShow(id).reservationStatus).toBe('NoShow');
  });

  // 아직 오지 않은 예약을 노쇼로 찍으면 팔 수 있는 재고가 사라진다.
  it('도착일이 오지 않은 예약은 거절한다', () => {
    const id = createReservation(day(5), day(6));
    expect(() => noShow(id)).toThrow(/도착일/);
  });

  it('이미 취소된 예약은 노쇼로 바꿀 수 없다', () => {
    const id = createReservation(day(-1), day(1));
    mockOperaRequest(`${RESERVATIONS}/${id}`, { method: 'DELETE', hotelId: 'SAND01' });
    expect(() => noShow(id)).toThrow(/노쇼 처리할 수 없습니다/);
  });

  // 노쇼는 삭제가 아니라 상태 전이다 — 수수료 청구 근거와 예측 이력이 남아야 한다.
  it('노쇼 후에도 조회된다', () => {
    const id = createReservation(day(-1), day(1));
    noShow(id);
    const fetched = mockOperaRequest<{ reservationStatus: string }>(`${RESERVATIONS}/${id}`, {
      hotelId: 'SAND01',
    });
    expect(fetched.reservationStatus).toBe('NoShow');
  });
});
