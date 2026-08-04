import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface FolioRow {
  folioId: string;
  window: number;
  status: string;
  balance: number;
  postings: Array<{
    postingId: string;
    type: string;
    amount: number;
    description: string;
    reference?: string;
    voidedById?: string;
    transferredFromWindow?: number;
  }>;
}

function book(): string {
  const created = mockOperaRequest<{ reservationId: string }>(
    '/rsv/v1/hotels/SAND01/reservations',
    {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: { arrivalDate: day(0), departureDate: day(2), roomType: 'STDT' },
        guest: { givenName: 'A', surname: 'B' },
      },
    },
  );
  return created.reservationId;
}

function folioPath(reservationId: string): string {
  return `/csh/v1/hotels/SAND01/reservations/${reservationId}/folios`;
}

function listFolios(reservationId: string): FolioRow[] {
  return mockOperaRequest<{ folios: FolioRow[] }>(folioPath(reservationId), { hotelId: 'SAND01' })
    .folios;
}

function openWindow(reservationId: string, window?: number): FolioRow {
  return mockOperaRequest<FolioRow>(folioPath(reservationId), {
    method: 'POST',
    hotelId: 'SAND01',
    body: window === undefined ? {} : { window },
  });
}

function post(reservationId: string, window: number, body: Record<string, unknown>): FolioRow {
  return mockOperaRequest<FolioRow>(`${folioPath(reservationId)}/${window}/postings`, {
    method: 'POST',
    hotelId: 'SAND01',
    body,
  });
}

const CHARGE = { type: 'Charge', transactionCode: '1000', description: '객실료', amount: 240000 };

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 폴리오', () => {
  it('처음 조회하면 1번 창구를 열어 준다', () => {
    const id = book();
    const folios = listFolios(id);

    expect(folios).toHaveLength(1);
    expect(folios[0]).toMatchObject({ window: 1, status: 'Open', balance: 0 });
  });

  it('없는 예약은 거절한다', () => {
    expect(() => listFolios('RSV-0000')).toThrow(OperaApiError);
  });

  it('윈도를 비어 있는 다음 번호로 연다', () => {
    const id = book();
    listFolios(id);

    expect(openWindow(id).window).toBe(2);
    expect(openWindow(id).window).toBe(3);
  });

  it('이미 열린 번호는 거절한다', () => {
    const id = book();
    openWindow(id, 2);

    expect(() => openWindow(id, 2)).toThrowError(/이미 열려 있습니다/);
  });

  it('윈도를 8개 넘게 열지 않는다', () => {
    const id = book();
    for (let window = 2; window <= 8; window += 1) openWindow(id, window);

    expect(() => openWindow(id)).toThrowError(/8개까지만/);
  });
});

describe('모의 OPERA — 거래', () => {
  it('청구는 잔액을 늘린다', () => {
    const id = book();
    const folio = post(id, 1, CHARGE);

    expect(folio.balance).toBe(240000);
    expect(folio.postings[0]?.amount).toBe(240000);
  });

  it('결제는 잔액을 줄인다', () => {
    const id = book();
    post(id, 1, CHARGE);
    const folio = post(id, 1, {
      type: 'Payment',
      transactionCode: '5000',
      description: '카드',
      amount: 240000,
    });

    expect(folio.balance).toBe(0);
  });

  it('조정은 방향을 지정할 수 있다', () => {
    const id = book();
    post(id, 1, CHARGE);
    const folio = post(id, 1, {
      type: 'Adjustment',
      transactionCode: '7000',
      description: '할인',
      amount: 40000,
      negative: true,
    });

    expect(folio.balance).toBe(200000);
  });

  it('알 수 없는 종류는 거절한다', () => {
    const id = book();

    expect(() =>
      post(id, 1, { type: 'Refund', transactionCode: '1', description: 'x', amount: 1 }),
    ).toThrowError(/알 수 없는 거래 종류/);
  });

  /*
   * 네트워크가 끊겨 POS 가 재전송하는 일은 흔하다. 두 번 달리면 손님에게 두 번
   * 청구되고 되돌리기 어렵다.
   */
  it('같은 전표는 한 번만 달린다', () => {
    const id = book();
    post(id, 1, { ...CHARGE, reference: 'CHK-1' });
    const folio = post(id, 1, { ...CHARGE, reference: 'CHK-1' });

    expect(folio.postings).toHaveLength(1);
    expect(folio.balance).toBe(240000);
  });

  it('열려 있지 않은 창구에는 달 수 없다', () => {
    const id = book();

    expect(() => post(id, 3, CHARGE)).toThrowError(/열려 있지 않습니다/);
  });

  it('마감된 창구에는 달 수 없다', () => {
    const id = book();
    mockOperaRequest(`${folioPath(id)}/1/close`, { method: 'POST', hotelId: 'SAND01', body: {} });

    expect(() => post(id, 1, CHARGE)).toThrowError(/이미 마감/);
  });
});

describe('모의 OPERA — 거래 취소', () => {
  it('지우지 않고 반대 부호 조정을 단다', () => {
    const id = book();
    const before = post(id, 1, CHARGE);
    const postingId = before.postings[0]!.postingId;

    const folio = mockOperaRequest<FolioRow>(`${folioPath(id)}/postings/${postingId}/void`, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {},
    });

    expect(folio.balance).toBe(0);
    expect(folio.postings).toHaveLength(2);
    expect(folio.postings[0]?.voidedById).toBe(folio.postings[1]?.postingId);
  });

  it('두 번 취소하지 않는다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;
    mockOperaRequest(`${folioPath(id)}/postings/${postingId}/void`, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {},
    });

    expect(() =>
      mockOperaRequest(`${folioPath(id)}/postings/${postingId}/void`, {
        method: 'POST',
        hotelId: 'SAND01',
        body: {},
      }),
    ).toThrowError(/이미 취소된/);
  });

  it('없는 거래는 거절한다', () => {
    const id = book();
    listFolios(id);

    expect(() =>
      mockOperaRequest(`${folioPath(id)}/postings/PST-0000/void`, {
        method: 'POST',
        hotelId: 'SAND01',
        body: {},
      }),
    ).toThrow(OperaApiError);
  });
});

describe('모의 OPERA — 거래 이관', () => {
  function transfer(reservationId: string, postingId: string, toWindow: number) {
    return mockOperaRequest<{ folios: FolioRow[] }>(
      `${folioPath(reservationId)}/postings/${postingId}/transfer`,
      { method: 'POST', hotelId: 'SAND01', body: { toWindow } },
    );
  }

  it('양쪽 잔액이 함께 움직인다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;
    openWindow(id, 2);

    const result = transfer(id, postingId, 2);

    expect(result.folios.find((f) => f.window === 1)?.balance).toBe(0);
    expect(result.folios.find((f) => f.window === 2)?.balance).toBe(240000);
  });

  it('어디서 왔는지 남긴다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;
    openWindow(id, 2);

    const result = transfer(id, postingId, 2);
    expect(result.folios.find((f) => f.window === 2)?.postings[0]?.transferredFromWindow).toBe(1);
  });

  it('같은 창구로는 옮기지 않는다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;

    expect(() => transfer(id, postingId, 1)).toThrowError(/이미 윈도 1/);
  });

  it('열려 있지 않은 창구로는 옮기지 않는다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;

    expect(() => transfer(id, postingId, 4)).toThrowError(/열려 있지 않습니다/);
  });

  // 원본과 조정이 갈라지면 양쪽 잔액이 모두 틀어진다.
  it('취소된 거래와 그 조정은 옮기지 않는다', () => {
    const id = book();
    const postingId = post(id, 1, CHARGE).postings[0]!.postingId;
    const voided = mockOperaRequest<FolioRow>(`${folioPath(id)}/postings/${postingId}/void`, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {},
    });
    openWindow(id, 2);

    expect(() => transfer(id, postingId, 2)).toThrowError(/취소된 거래/);
    expect(() => transfer(id, voided.postings[1]!.postingId, 2)).toThrowError(/취소 조정/);
  });
});

describe('모의 OPERA — 폴리오 마감', () => {
  it('잔액이 0 이면 닫는다', () => {
    const id = book();
    listFolios(id);

    const folio = mockOperaRequest<FolioRow>(`${folioPath(id)}/1/close`, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {},
    });
    expect(folio.status).toBe('Closed');
  });

  // 잔액이 남은 폴리오를 닫으면 매출 누락으로 이어진다.
  it('잔액이 남으면 닫지 않는다', () => {
    const id = book();
    post(id, 1, CHARGE);

    expect(() =>
      mockOperaRequest(`${folioPath(id)}/1/close`, {
        method: 'POST',
        hotelId: 'SAND01',
        body: {},
      }),
    ).toThrowError(/잔액이 남아 있어/);
  });
});
