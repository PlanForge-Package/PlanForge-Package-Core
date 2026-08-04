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

  // 안내와 청구가 갈리면 손님이 본 금액과 폴리오에 달리는 금액이 달라진다.
  it('총액이 요금 조회와 같다', () => {
    const arrival = tomorrow(1);
    const departure = tomorrow(3);

    const quoted = mockOperaRequest<{
      ratePlans: Array<{ ratePlanCode: string; roomType: string; total: { amount: number } }>;
    }>('/rtp/v1/hotels/SAND01/rates', {
      hotelId: 'SAND01',
      query: { startDate: arrival, endDate: departure, roomType: 'DLXK', ratePlanCode: 'BAR' },
    });

    const created = mockOperaRequest<{ roomStay: { total: { amount: number } } }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: arrival,
            departureDate: departure,
            roomType: 'DLXK',
            ratePlanCode: 'BAR',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    expect(created.roomStay.total.amount).toBe(quoted.ratePlans[0]?.total.amount);
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
    const before = mockOperaRequest<{ roomStay: { total: { amount: number } } }>(
      `/rsv/v1/hotels/SAND01/reservations/${id}`,
      { hotelId: 'SAND01' },
    );

    const updated = mockOperaRequest<{ roomStay: { roomType: string; total: { amount: number } } }>(
      `/rsv/v1/hotels/SAND01/reservations/${id}`,
      { method: 'PATCH', hotelId: 'SAND01', body: { roomStay: { roomType: 'SUIT' } } },
    );

    const quoted = mockOperaRequest<{ ratePlans: Array<{ total: { amount: number } }> }>(
      '/rtp/v1/hotels/SAND01/rates',
      {
        hotelId: 'SAND01',
        query: {
          startDate: tomorrow(1),
          endDate: tomorrow(2),
          roomType: 'SUIT',
          ratePlanCode: 'BAR',
        },
      },
    );

    expect(updated.roomStay.roomType).toBe('SUIT');
    expect(updated.roomStay.total.amount).toBe(quoted.ratePlans[0]?.total.amount);
    // 스탠다드에서 스위트로 올렸으니 금액도 올라야 한다.
    expect(updated.roomStay.total.amount).toBeGreaterThan(before.roomStay.total.amount);
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
    // 스위트 재고 4개 중 1502 는 시드에서 공사 중(OutOfOrder)이라 팔 수 없다.
    expect(result.roomStays.find((r) => r.roomType === 'SUIT')?.available).toBe(3);
  });
});

describe('모의 OPERA — 요금', () => {
  it('일자별 단가와 총액을 함께 준다', () => {
    const result = mockOperaRequest<{
      ratePlans: Array<{
        ratePlanCode: string;
        roomType: string;
        nightlyRates: Array<{ date: string; amount: number; packageAmount: number }>;
        total: { amount: number };
      }>;
    }>('/rtp/v1/hotels/SAND01/rates', {
      hotelId: 'SAND01',
      query: { startDate: tomorrow(1), endDate: tomorrow(4), ratePlanCode: 'BAR' },
    });

    const deluxe = result.ratePlans.find((p) => p.roomType === 'DLXK');
    expect(deluxe?.nightlyRates).toHaveLength(3);
    // 총액은 일자별 단가의 합이다. 따로 계산하면 시즌이 붙는 순간 갈린다.
    const summed = (deluxe?.nightlyRates ?? []).reduce(
      (sum, night) => sum + night.amount + night.packageAmount,
      0,
    );
    expect(deluxe?.total.amount).toBe(summed);
  });
});

describe('모의 OPERA — 미구현 경로', () => {
  it('다루지 않는 경로는 501 로 분명히 알린다', () => {
    expect(() => mockOperaRequest('/xyz/v1/unknown', { hotelId: 'SAND01' })).toThrow(
      /모의 모드가 아직 다루지 않는/,
    );
  });
});
