import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

const HOTEL = 'SAND01';
const CODES = `/csh/v1/hotels/${HOTEL}/transactionCodes`;

interface TxnCode {
  transactionCode: string;
  name: string;
  group: string;
  vatRate: number;
  serviceChargeRate: number;
  taxInclusive: boolean;
  active: boolean;
}

function list(query: Record<string, string | undefined> = {}): TxnCode[] {
  return mockOperaRequest<{ transactionCodes: TxnCode[] }>(CODES, { hotelId: HOTEL, query })
    .transactionCodes;
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 거래 코드', () => {
  it('기본 코드가 준비되어 있다', () => {
    const codes = list().map((row) => row.transactionCode);
    expect(codes).toContain('1000');
    expect(codes).toContain('2000');
    expect(codes).toContain('5000');
  });

  // Rooms carry no service charge, F&B does. The journal has to see the difference.
  it('매출 그룹과 세율을 함께 준다', () => {
    const room = list().find((row) => row.transactionCode === '1000');
    const fnb = list().find((row) => row.transactionCode === '2000');

    expect(room?.group).toBe('Room');
    expect(room?.vatRate).toBe(0.1);
    expect(room?.serviceChargeRate).toBe(0);
    expect(fnb?.group).toBe('FoodBeverage');
    expect(fnb?.serviceChargeRate).toBe(0.1);
  });

  it('결제 코드는 매출이 아니다', () => {
    const payment = list().find((row) => row.transactionCode === '5000');
    expect(payment?.group).toBe('Payment');
    expect(payment?.vatRate).toBe(0);
  });

  it('등록하면 목록에 나온다', () => {
    mockOperaRequest(CODES, {
      method: 'POST',
      hotelId: HOTEL,
      body: { transactionCode: '3200', name: '바', group: 'FoodBeverage', serviceChargeRate: 0.1 },
    });

    expect(list().map((row) => row.transactionCode)).toContain('3200');
  });

  it('같은 코드는 두 번 만들지 않는다', () => {
    expect(() =>
      mockOperaRequest(CODES, {
        method: 'POST',
        hotelId: HOTEL,
        body: { transactionCode: '1000', name: '중복', group: 'Room' },
      }),
    ).toThrow(/이미 쓰고 있는 거래 코드/);
  });

  it('알 수 없는 매출 그룹은 거절한다', () => {
    expect(() =>
      mockOperaRequest(CODES, {
        method: 'POST',
        hotelId: HOTEL,
        body: { transactionCode: '3300', name: '이상', group: 'Nope' },
      }),
    ).toThrow(/알 수 없는 매출 그룹/);
  });

  it('세율을 고칠 수 있다', () => {
    const updated = mockOperaRequest<TxnCode>(`${CODES}/2000`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { serviceChargeRate: 0 },
    });

    expect(updated.serviceChargeRate).toBe(0);
  });

  // Inactive codes cannot be posted, but reading past closings still needs their names.
  it('중지한 코드는 기본 목록에서 빠지고 포함 조회에는 나온다', () => {
    mockOperaRequest(`${CODES}/4000`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { active: false },
    });

    expect(list().map((row) => row.transactionCode)).not.toContain('4000');
    expect(list({ includeInactive: 'true' }).map((row) => row.transactionCode)).toContain('4000');
  });

  it('없는 코드 수정은 404 로 알린다', () => {
    expect(() =>
      mockOperaRequest(`${CODES}/9999`, {
        method: 'PATCH',
        hotelId: HOTEL,
        body: { name: 'x' },
      }),
    ).toThrow(/거래 코드를 찾을 수 없습니다/);
  });
});
