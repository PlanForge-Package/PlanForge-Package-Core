import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

const HOTEL = 'SAND01';
const RESERVATIONS = `/rsv/v1/hotels/${HOTEL}/reservations`;

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface Reservation {
  reservationId: string;
  reservationStatus: string;
  guaranteeCode?: string;
  cancellationPenalty?: number;
  roomStay: { total: { amount: number } };
}

interface Policies {
  guaranteeCode: string;
  cancellation: {
    policyName: string;
    freeUntil: string;
    withinFreeWindow: boolean;
    penaltyAmount: number;
  };
  deposit: { requiredAmount: number; dueDate?: string; paidAmount: number };
}

function book(overrides: Record<string, unknown> = {}, arrivalOffset = 10): Reservation {
  return mockOperaRequest<Reservation>(RESERVATIONS, {
    method: 'POST',
    hotelId: HOTEL,
    body: {
      roomStay: {
        arrivalDate: day(arrivalOffset),
        departureDate: day(arrivalOffset + 2),
        roomType: 'STDT',
        ratePlanCode: 'BAR',
      },
      guest: { givenName: 'A', surname: 'B' },
      ...overrides,
    },
  });
}

function policies(id: string): Policies {
  return mockOperaRequest<Policies>(`${RESERVATIONS}/${id}/policies`, { hotelId: HOTEL });
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 보증 방식', () => {
  // 아무 보증 없이 받은 예약은 18시까지만 잡아 둔다.
  it('기본은 6PM 이다', () => {
    expect(book().guaranteeCode).toBe('SIXPM');
  });

  it('예약할 때 지정할 수 있다', () => {
    expect(book({ guaranteeCode: 'creditcard' }).guaranteeCode).toBe('CREDITCARD');
  });

  it('알 수 없는 보증 방식은 거절한다', () => {
    expect(() => book({ guaranteeCode: 'NOPE' })).toThrow(/알 수 없는 보증 방식/);
  });

  it('나중에 바꿀 수 있다', () => {
    const created = book();
    const updated = mockOperaRequest<Reservation>(
      `${RESERVATIONS}/${created.reservationId}/guarantee`,
      { method: 'PUT', hotelId: HOTEL, body: { guaranteeCode: 'DEPOSIT' } },
    );

    expect(updated.guaranteeCode).toBe('DEPOSIT');
    expect(policies(created.reservationId).guaranteeCode).toBe('DEPOSIT');
  });

  it('취소된 예약의 보증 방식은 바꾸지 않는다', () => {
    const created = book();
    mockOperaRequest(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/guarantee`, {
        method: 'PUT',
        hotelId: HOTEL,
        body: { guaranteeCode: 'DEPOSIT' },
      }),
    ).toThrow(/보증 방식을 바꿀 수 없습니다/);
  });
});

describe('모의 OPERA — 취소 위약금', () => {
  it('기한 안이면 위약금이 없다', () => {
    const created = book({}, 10);
    const result = policies(created.reservationId);

    expect(result.cancellation.withinFreeWindow).toBe(true);
    expect(result.cancellation.penaltyAmount).toBe(0);
  });

  // BAR 은 도착 30시간 전까지 무료이고 그 뒤에는 1박을 받는다.
  it('기한을 넘기면 1박을 물린다', () => {
    const created = book({}, 0);
    const result = policies(created.reservationId);

    expect(result.cancellation.withinFreeWindow).toBe(false);
    expect(result.cancellation.penaltyAmount).toBe(Math.round(created.roomStay.total.amount / 2));
  });

  it('취소가 자유로운 요금은 당일에도 0 이다', () => {
    const created = book({ roomStay: { ratePlanCode: 'CORP' } }, 0);
    const corp = mockOperaRequest<Reservation>(RESERVATIONS, {
      method: 'POST',
      hotelId: HOTEL,
      body: {
        roomStay: {
          arrivalDate: day(0),
          departureDate: day(2),
          roomType: 'STDT',
          ratePlanCode: 'CORP',
        },
        guest: { givenName: 'C', surname: 'D' },
      },
    });
    expect(created.reservationId).not.toBe(corp.reservationId);

    expect(policies(corp.reservationId).cancellation.penaltyAmount).toBe(0);
  });

  // 물린 위약금을 폴리오에 달지 않으면 받을 근거가 사라진다.
  it('취소하면 위약금이 폴리오에 달린다', () => {
    const created = book({}, 0);
    const cancelled = mockOperaRequest<Reservation>(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    expect(cancelled.reservationStatus).toBe('Cancelled');
    expect(cancelled.cancellationPenalty).toBeGreaterThan(0);

    const folios = mockOperaRequest<{
      folios: Array<{ balance: number; postings: Array<{ description: string }> }>;
    }>(`/csh/v1/hotels/${HOTEL}/reservations/${created.reservationId}/folios`, { hotelId: HOTEL });

    expect(folios.folios[0]?.balance).toBe(cancelled.cancellationPenalty);
    expect(folios.folios[0]?.postings[0]?.description).toMatch(/취소 위약금/);
  });

  it('기한 안에 취소하면 폴리오에 아무것도 달지 않는다', () => {
    const created = book({}, 10);
    const cancelled = mockOperaRequest<Reservation>(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    expect(cancelled.cancellationPenalty).toBe(0);

    // 조회는 1번 창구를 열어 주지만, 거래는 하나도 없어야 한다.
    const folios = mockOperaRequest<{ folios: Array<{ postings: unknown[]; balance: number }> }>(
      `/csh/v1/hotels/${HOTEL}/reservations/${created.reservationId}/folios`,
      { hotelId: HOTEL },
    );
    expect(folios.folios[0]?.postings).toHaveLength(0);
    expect(folios.folios[0]?.balance).toBe(0);
  });

  it('이미 취소된 예약은 다시 취소하지 않는다', () => {
    const created = book({}, 0);
    mockOperaRequest(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}`, {
        method: 'DELETE',
        hotelId: HOTEL,
      }),
    ).toThrow(/이미 취소된 예약/);
  });
});

describe('모의 OPERA — 보증금', () => {
  function withDepositPolicy() {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/BAR`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { depositPolicy: { type: 'FirstNight', value: 0, dueDaysBeforeArrival: 7 } },
    });
  }

  it('규정이 없으면 요구하지 않는다', () => {
    const created = book();
    expect(policies(created.reservationId).deposit.requiredAmount).toBe(0);
  });

  it('1박 규정이면 1박치를 요구한다', () => {
    withDepositPolicy();
    const created = book();
    const result = policies(created.reservationId);

    expect(result.deposit.requiredAmount).toBe(Math.round(created.roomStay.total.amount / 2));
    expect(result.deposit.dueDate).toBe(day(3));
  });

  // 도착 전이라 청구는 없지만 그 돈은 이미 우리에게 있다.
  it('받으면 폴리오에 결제로 올라간다', () => {
    const created = book();
    const folio = mockOperaRequest<{ balance: number; postings: Array<{ type: string }> }>(
      `${RESERVATIONS}/${created.reservationId}/deposit`,
      { method: 'POST', hotelId: HOTEL, body: { amount: 100000, description: '보증금' } },
    );

    expect(folio.balance).toBe(-100000);
    expect(folio.postings[0]?.type).toBe('Payment');
    expect(policies(created.reservationId).deposit.paidAmount).toBe(100000);
  });

  it('같은 전표는 두 번 받지 않는다', () => {
    const created = book();
    const body = { amount: 100000, reference: 'DEP-1' };
    mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/deposit`, {
      method: 'POST',
      hotelId: HOTEL,
      body,
    });

    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/deposit`, {
        method: 'POST',
        hotelId: HOTEL,
        body,
      }),
    ).toThrow(/이미 처리한 보증금/);
  });

  it('0 이하는 받지 않는다', () => {
    const created = book();
    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/deposit`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { amount: 0 },
      }),
    ).toThrow(/0보다 커야/);
  });

  it('취소된 예약에는 받지 않는다', () => {
    const created = book({}, 10);
    mockOperaRequest(`${RESERVATIONS}/${created.reservationId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    expect(() =>
      mockOperaRequest(`${RESERVATIONS}/${created.reservationId}/deposit`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { amount: 100000 },
      }),
    ).toThrow(/보증금을 받을 수 없습니다/);
  });

  it('없는 예약은 404 로 알린다', () => {
    expect(() => policies('NOPE')).toThrow(/예약을 찾을 수 없습니다/);
  });
});
