import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function tomorrow(offset = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 예약 생성', () => {
  it('생성하면 확인 번호가 붙어 돌아온다', () => {
    const created = mockOperaRequest<{ reservationId: string; confirmationNumber: string }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: tomorrow(1),
            departureDate: tomorrow(3),
            roomType: 'DLXK',
            adultCount: 2,
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    expect(created.reservationId).toMatch(/^OPERA-/);
    expect(created.confirmationNumber).toMatch(/^OP/);
  });

  // 시퀀스가 시드 번호와 겹치면 새 예약이 시드 예약을 덮어써 재고와 목록이 어긋난다.
  it('시드 예약 번호를 덮어쓰지 않는다', () => {
    const before = mockOperaRequest<{ totalResults: number }>(
      '/rsv/v1/hotels/SAND01/reservations',
      { hotelId: 'SAND01' },
    );

    const created = mockOperaRequest<{ reservationId: string }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: tomorrow(1), departureDate: tomorrow(2), roomType: 'STDT' },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    expect(['OPERA-1001', 'OPERA-1002']).not.toContain(created.reservationId);

    const after = mockOperaRequest<{ totalResults: number }>('/rsv/v1/hotels/SAND01/reservations', {
      hotelId: 'SAND01',
    });
    expect(after.totalResults).toBe(before.totalResults + 1);
  });

  it('총액을 박수만큼 계산해 돌려준다', () => {
    const created = mockOperaRequest<{ roomStay: { total: { amount: number } } }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: tomorrow(1), departureDate: tomorrow(3), roomType: 'DLXK' },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );
    // DLXK 240,000 × 2박
    expect(created.roomStay.total.amount).toBe(480000);
  });

  it('알 수 없는 객실 타입은 400 으로 거절한다', () => {
    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: tomorrow(1), departureDate: tomorrow(2), roomType: 'NOPE' },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(OperaApiError);
  });

  it('출발일이 도착일보다 앞서면 거절한다', () => {
    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: tomorrow(3), departureDate: tomorrow(1), roomType: 'DLXK' },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(/출발일/);
  });
});

describe('모의 OPERA — 수정·취소', () => {
  function create(): string {
    const created = mockOperaRequest<{ reservationId: string }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: tomorrow(1), departureDate: tomorrow(2), roomType: 'STDT' },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );
    return created.reservationId;
  }

  it('수정하면 총액이 다시 계산된다', () => {
    const id = create();
    const updated = mockOperaRequest<{ roomStay: { roomType: string; total: { amount: number } } }>(
      `/rsv/v1/hotels/SAND01/reservations/${id}`,
      { method: 'PATCH', hotelId: 'SAND01', body: { roomStay: { roomType: 'SUIT' } } },
    );
    expect(updated.roomStay.roomType).toBe('SUIT');
    // SUIT 400,000 × 1박
    expect(updated.roomStay.total.amount).toBe(400000);
  });

  it('취소는 삭제가 아니라 상태 전이다', () => {
    const id = create();
    const cancelled = mockOperaRequest<{ reservationStatus: string }>(
      `/rsv/v1/hotels/SAND01/reservations/${id}`,
      { method: 'DELETE', hotelId: 'SAND01' },
    );
    expect(cancelled.reservationStatus).toBe('Cancelled');

    // 취소 후에도 조회된다 — 이력이 남아야 하기 때문이다.
    const fetched = mockOperaRequest<{ reservationStatus: string }>(
      `/rsv/v1/hotels/SAND01/reservations/${id}`,
      { hotelId: 'SAND01' },
    );
    expect(fetched.reservationStatus).toBe('Cancelled');
  });

  it('없는 예약은 404 로 알린다', () => {
    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations/NOPE', { hotelId: 'SAND01' }),
    ).toThrow(/찾을 수 없습니다/);
  });
});

describe('모의 OPERA — 재고', () => {
  it('예약이 늘면 남은 재고가 준다', () => {
    const before = mockOperaRequest<{ roomStays: Array<{ roomType: string; available: number }> }>(
      '/par/v1/hotels/SAND01/availability',
      { hotelId: 'SAND01', query: { startDate: tomorrow(1), endDate: tomorrow(2) } },
    );
    const suiteBefore = before.roomStays.find((r) => r.roomType === 'SUIT')?.available ?? 0;

    mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: { arrivalDate: tomorrow(1), departureDate: tomorrow(2), roomType: 'SUIT' },
        guest: { givenName: 'A', surname: 'B' },
      },
    });

    const after = mockOperaRequest<{ roomStays: Array<{ roomType: string; available: number }> }>(
      '/par/v1/hotels/SAND01/availability',
      { hotelId: 'SAND01', query: { startDate: tomorrow(1), endDate: tomorrow(2) } },
    );
    const suiteAfter = after.roomStays.find((r) => r.roomType === 'SUIT')?.available ?? 0;

    expect(suiteAfter).toBe(suiteBefore - 1);
  });

  it('기간이 겹치지 않으면 재고를 차지하지 않는다', () => {
    mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: { arrivalDate: tomorrow(10), departureDate: tomorrow(11), roomType: 'SUIT' },
        guest: { givenName: 'A', surname: 'B' },
      },
    });

    const result = mockOperaRequest<{ roomStays: Array<{ roomType: string; available: number }> }>(
      '/par/v1/hotels/SAND01/availability',
      { hotelId: 'SAND01', query: { startDate: tomorrow(1), endDate: tomorrow(2) } },
    );
    expect(result.roomStays.find((r) => r.roomType === 'SUIT')?.available).toBe(4);
  });
});

describe('모의 OPERA — 요금', () => {
  it('일자별 단가와 총액을 함께 준다', () => {
    const result = mockOperaRequest<{
      ratePlans: Array<{ roomType: string; nightlyRates: unknown[]; total: { amount: number } }>;
    }>('/rtp/v1/hotels/SAND01/rates', {
      hotelId: 'SAND01',
      query: { startDate: tomorrow(1), endDate: tomorrow(4) },
    });

    const deluxe = result.ratePlans.find((p) => p.roomType === 'DLXK');
    expect(deluxe?.nightlyRates).toHaveLength(3);
    expect(deluxe?.total.amount).toBe(240000 * 3);
  });
});

describe('모의 OPERA — 미구현 경로', () => {
  it('다루지 않는 경로는 501 로 분명히 알린다', () => {
    expect(() => mockOperaRequest('/xyz/v1/unknown', { hotelId: 'SAND01' })).toThrow(
      /모의 모드가 아직 다루지 않는/,
    );
  });
});
