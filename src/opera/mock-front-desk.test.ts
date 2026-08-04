import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RESERVATIONS = '/rsv/v1/hotels/SAND01/reservations';
const ROOMS = '/hsk/v1/hotels/SAND01/rooms';

interface MockReservationRow {
  reservationId: string;
  confirmationNumber: string;
  reservationStatus: string;
  roomStay: { roomId?: string; arrivalDate: string; departureDate: string };
}

function book(arrival = day(0), departure = day(2), roomType = 'STDT'): MockReservationRow {
  return mockOperaRequest<MockReservationRow>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: { arrivalDate: arrival, departureDate: departure, roomType },
      guest: { givenName: 'A', surname: 'B' },
    },
  });
}

function checkIn(id: string, roomId: string): MockReservationRow {
  return mockOperaRequest<MockReservationRow>(`${RESERVATIONS}/${id}/checkIn`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: { roomId },
  });
}

function checkOut(id: string): MockReservationRow {
  return mockOperaRequest<MockReservationRow>(`${RESERVATIONS}/${id}/checkOut`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {},
  });
}

function room(roomId: string) {
  const result = mockOperaRequest<{
    rooms: Array<{ roomId: string; roomStatus: string; occupied: boolean }>;
  }>(ROOMS, { hotelId: 'SAND01' });
  return result.rooms.find((r) => r.roomId === roomId);
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 체크인', () => {
  it('상태를 InHouse 로 바꾸고 객실을 기록한다', () => {
    const created = book();
    const result = checkIn(created.reservationId, '1101');

    expect(result.reservationStatus).toBe('InHouse');
    expect(result.roomStay.roomId).toBe('1101');
  });

  it('배정한 객실을 재실로 표시한다', () => {
    const created = book();
    checkIn(created.reservationId, '1101');

    expect(room('1101')?.occupied).toBe(true);
  });

  it('객실 없이는 체크인할 수 없다', () => {
    const created = book();

    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/checkIn`, {
        method: 'POST',
        hotelId: 'SAND01',
        body: {},
      }),
    ).toThrowError(/객실을 배정/);
  });

  it('도착일 전에는 체크인할 수 없다', () => {
    const created = book(day(3), day(5));

    expect(() => checkIn(created.reservationId, '1101')).toThrowError(/도착일/);
  });

  it('이미 체크인한 예약은 다시 체크인하지 않는다', () => {
    const created = book();
    checkIn(created.reservationId, '1101');

    expect(() => checkIn(created.reservationId, '1101')).toThrowError(/체크인할 수 없습니다/);
  });

  it('취소된 예약은 체크인할 수 없다', () => {
    const created = book();
    mockOperaRequest(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: 'SAND01',
    });

    expect(() => checkIn(created.reservationId, '1101')).toThrowError(/체크인할 수 없습니다/);
  });

  it('다른 손님이 든 객실에는 배정하지 않는다', () => {
    const first = book();
    checkIn(first.reservationId, '1101');

    const second = book();
    expect(() => checkIn(second.reservationId, '1101')).toThrowError(/사용 중/);
  });

  it('사용 불가 기간인 객실에는 배정하지 않는다', () => {
    mockOperaRequest('/hsk/v1/hotels/SAND01/outOfOrders', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomId: '1101',
        kind: 'OutOfService',
        startDate: day(0),
        endDate: day(3),
        reason: '도색',
      },
    });

    const created = book();
    expect(() => checkIn(created.reservationId, '1101')).toThrowError(/사용 불가/);
  });

  it('없는 객실은 거절한다', () => {
    const created = book();
    expect(() => checkIn(created.reservationId, '9999')).toThrow(OperaApiError);
  });
});

describe('모의 OPERA — 체크아웃', () => {
  it('상태를 CheckedOut 으로 바꾼다', () => {
    const created = book();
    checkIn(created.reservationId, '1101');

    expect(checkOut(created.reservationId).reservationStatus).toBe('CheckedOut');
  });

  it('나간 객실은 비고 청소 대상이 된다', () => {
    const created = book();
    checkIn(created.reservationId, '1101');
    checkOut(created.reservationId);

    // 청소 완료로 두면 치우지 않은 방이 판매 가능으로 보인다.
    expect(room('1101')).toMatchObject({ occupied: false, roomStatus: 'Dirty' });
  });

  it('재실이 아닌 예약은 체크아웃할 수 없다', () => {
    const created = book();

    expect(() => checkOut(created.reservationId)).toThrowError(/체크아웃할 수 없습니다/);
  });

  it('체크아웃한 객실은 다음 손님에게 배정할 수 있다', () => {
    const first = book();
    checkIn(first.reservationId, '1101');
    checkOut(first.reservationId);

    const second = book();
    expect(checkIn(second.reservationId, '1101').roomStay.roomId).toBe('1101');
  });

  it('없는 예약은 거절한다', () => {
    expect(() => checkOut('RSV-0000')).toThrow(OperaApiError);
  });
});
