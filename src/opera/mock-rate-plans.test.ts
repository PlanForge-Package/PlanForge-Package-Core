import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

const HOTEL = 'SAND01';

beforeEach(() => {
  resetMockStore();
});

/** 요일이 정해진 날짜를 찾는다. 주말 시즌 검증은 실행 날짜에 흔들리면 안 된다. */
function nextDayOfWeek(day: number, from = 30): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + from);
  while (date.getUTCDay() !== day) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

interface RatePlan {
  ratePlanCode: string;
  name: string;
  baseAmounts: Record<string, number>;
  seasons: Array<{ seasonId: string; name: string; amounts: Record<string, number> }>;
  packageCodes: string[];
  status: string;
  sellStartDate: string;
  sellEndDate: string;
}

interface RateOffer {
  ratePlanCode: string;
  ratePlanName: string;
  roomType: string;
  nightlyRates: Array<{ date: string; amount: number; packageAmount: number }>;
  packages: Array<{ packageCode: string; includedInRate: boolean }>;
  total: { amount: number };
}

function quote(query: Record<string, string | number | undefined>): RateOffer[] {
  return mockOperaRequest<{ ratePlans: RateOffer[] }>(`/rtp/v1/hotels/${HOTEL}/rates`, {
    hotelId: HOTEL,
    query,
  }).ratePlans;
}

function listPlans(): RatePlan[] {
  return mockOperaRequest<{ ratePlans: RatePlan[] }>(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
    hotelId: HOTEL,
  }).ratePlans;
}

describe('모의 OPERA — 요금 코드', () => {
  it('기본 요금 코드가 준비되어 있다', () => {
    const codes = listPlans().map((plan) => plan.ratePlanCode);
    expect(codes).toContain('BAR');
    expect(codes).toContain('CORP');
  });

  it('등록하면 목록에 나온다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
      method: 'POST',
      hotelId: HOTEL,
      body: {
        ratePlanCode: 'PROMO',
        name: '프로모션',
        sellStartDate: nextDayOfWeek(1),
        sellEndDate: addDays(nextDayOfWeek(1), 30),
        baseAmounts: { STDT: 150000 },
      },
    });

    expect(listPlans().map((p) => p.ratePlanCode)).toContain('PROMO');
  });

  it('같은 코드는 두 번 만들지 않는다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          ratePlanCode: 'BAR',
          name: '중복',
          sellStartDate: nextDayOfWeek(1),
          sellEndDate: addDays(nextDayOfWeek(1), 10),
          baseAmounts: { STDT: 100000 },
        },
      }),
    ).toThrow(/이미 쓰고 있는 요금 코드/);
  });

  // 팔 수 없는 요금을 만들어 두면 예약 화면에 금액 없는 선택지가 생긴다.
  it('기준 요금이 하나도 없으면 거절한다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          ratePlanCode: 'EMPTY',
          name: '빈 요금',
          sellStartDate: nextDayOfWeek(1),
          sellEndDate: addDays(nextDayOfWeek(1), 10),
          baseAmounts: {},
        },
      }),
    ).toThrow(/기준 요금이 하나도 없습니다/);
  });

  it('알 수 없는 객실 타입은 거절한다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          ratePlanCode: 'BADTYPE',
          name: '이상한 타입',
          sellStartDate: nextDayOfWeek(1),
          sellEndDate: addDays(nextDayOfWeek(1), 10),
          baseAmounts: { NOPE: 100000 },
        },
      }),
    ).toThrow(/알 수 없는 객실 타입/);
  });

  it('판매 종료일이 시작일보다 앞서면 거절한다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          ratePlanCode: 'BADDATE',
          name: '거꾸로',
          sellStartDate: addDays(nextDayOfWeek(1), 10),
          sellEndDate: nextDayOfWeek(1),
          baseAmounts: { STDT: 100000 },
        },
      }),
    ).toThrow(/판매 종료일/);
  });

  it('없는 패키지를 붙이면 거절한다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          ratePlanCode: 'BADPKG',
          name: '없는 패키지',
          sellStartDate: nextDayOfWeek(1),
          sellEndDate: addDays(nextDayOfWeek(1), 10),
          baseAmounts: { STDT: 100000 },
          packageCodes: ['NOPE'],
        },
      }),
    ).toThrow(/알 수 없는 패키지 코드/);
  });

  it('수정하면 기준 요금이 바뀐다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { baseAmounts: { STDT: 111000, DLXK: 222000 } },
    });

    const plan = listPlans().find((p) => p.ratePlanCode === 'CORP');
    expect(plan?.baseAmounts.STDT).toBe(111000);
    expect(plan?.baseAmounts.SUIT).toBeUndefined();
  });

  it('없는 요금 코드는 400 으로 알린다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/NOPE`, { hotelId: HOTEL }),
    ).toThrow(/알 수 없는 요금 코드/);
  });
});

describe('모의 OPERA — 시즌 요금', () => {
  const sunday = nextDayOfWeek(0, 400);

  it('시즌이 걸린 날은 기준 요금 대신 시즌 요금이 나온다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
      method: 'POST',
      hotelId: HOTEL,
      body: {
        name: '검증 시즌',
        startDate: sunday,
        endDate: sunday,
        amounts: { DLXK: 999000 },
      },
    });

    const offers = quote({
      startDate: sunday,
      endDate: addDays(sunday, 1),
      roomType: 'DLXK',
      ratePlanCode: 'CORP',
    });
    expect(offers[0]?.nightlyRates[0]?.amount).toBe(999000);
  });

  // 겹치도록 두면 무엇이 이기는지가 등록 순서에 달린다.
  it('기간이 겹치는 시즌은 거절한다', () => {
    const body = {
      name: '겹침',
      startDate: sunday,
      endDate: addDays(sunday, 3),
      amounts: { STDT: 100000 },
    };
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
      method: 'POST',
      hotelId: HOTEL,
      body,
    });

    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { ...body, name: '또 겹침' },
      }),
    ).toThrow(/기간이 겹치는 시즌/);
  });

  it('요일이 갈리면 같은 기간이어도 등록된다', () => {
    const range = { startDate: sunday, endDate: addDays(sunday, 6) };
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
      method: 'POST',
      hotelId: HOTEL,
      body: { ...range, name: '주중', daysOfWeek: [0, 1, 2, 3, 4], amounts: { STDT: 100000 } },
    });

    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { ...range, name: '주말', daysOfWeek: [5, 6], amounts: { STDT: 130000 } },
      }),
    ).not.toThrow();
  });

  it('객실 타입이 다르면 겹쳐도 등록된다', () => {
    const range = { startDate: sunday, endDate: addDays(sunday, 6) };
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
      method: 'POST',
      hotelId: HOTEL,
      body: { ...range, name: '스탠다드', amounts: { STDT: 100000 } },
    });

    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { ...range, name: '디럭스', amounts: { DLXK: 150000 } },
      }),
    ).not.toThrow();
  });

  it('그 요금이 팔지 않는 객실 타입의 시즌은 거절한다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { baseAmounts: { STDT: 160000 } },
    });

    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
        method: 'POST',
        hotelId: HOTEL,
        body: { name: 'x', startDate: sunday, endDate: sunday, amounts: { SUIT: 500000 } },
      }),
    ).toThrow(/팔지 않는 객실 타입/);
  });

  it('지우면 기준 요금으로 돌아온다', () => {
    const plan = mockOperaRequest<RatePlan>(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons`, {
      method: 'POST',
      hotelId: HOTEL,
      body: { name: '한시', startDate: sunday, endDate: sunday, amounts: { DLXK: 999000 } },
    });
    const seasonId = plan.seasons[plan.seasons.length - 1]?.seasonId ?? '';

    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons/${seasonId}`, {
      method: 'DELETE',
      hotelId: HOTEL,
    });

    const offers = quote({
      startDate: sunday,
      endDate: addDays(sunday, 1),
      roomType: 'DLXK',
      ratePlanCode: 'CORP',
    });
    expect(offers[0]?.nightlyRates[0]?.amount).toBe(200000);
  });

  it('없는 시즌은 404 로 알린다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP/seasons/NOPE`, {
        method: 'DELETE',
        hotelId: HOTEL,
      }),
    ).toThrow(/시즌을 찾을 수 없습니다/);
  });
});

describe('모의 OPERA — 패키지', () => {
  const monday = nextDayOfWeek(1, 400);

  it('요금에 포함된 패키지는 총액을 올리지 않는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/packages/BFAST`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { includedInRate: true },
    });

    const offers = quote({
      startDate: monday,
      endDate: addDays(monday, 1),
      roomType: 'STDT',
      ratePlanCode: 'CORP',
      adults: 2,
    });
    expect(offers[0]?.total.amount).toBe(160000);
    expect(offers[0]?.packages[0]?.includedInRate).toBe(true);
  });

  it('1인당 패키지는 인원수만큼 붙는다', () => {
    const one = quote({
      startDate: monday,
      endDate: addDays(monday, 1),
      roomType: 'STDT',
      ratePlanCode: 'CORP',
      adults: 1,
    });
    const two = quote({
      startDate: monday,
      endDate: addDays(monday, 1),
      roomType: 'STDT',
      ratePlanCode: 'CORP',
      adults: 2,
    });

    // 조식 25,000 × 1인 → 2인이면 25,000 이 더 붙는다.
    expect(one[0]?.total.amount).toBe(160000 + 25000);
    expect(two[0]?.total.amount).toBe(160000 + 50000);
  });

  it('투숙당 1회인 패키지는 첫날에만 붙는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { packageCodes: ['LATE'] },
    });

    const offers = quote({
      startDate: monday,
      endDate: addDays(monday, 3),
      roomType: 'STDT',
      ratePlanCode: 'CORP',
    });
    const nights = offers[0]?.nightlyRates ?? [];
    expect(nights[0]?.packageAmount).toBe(50000);
    expect(nights[1]?.packageAmount).toBe(0);
    expect(nights[2]?.packageAmount).toBe(0);
  });

  it('1박당 패키지는 매일 붙는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { packageCodes: ['PARK'] },
    });

    const offers = quote({
      startDate: monday,
      endDate: addDays(monday, 2),
      roomType: 'STDT',
      ratePlanCode: 'CORP',
    });
    expect(offers[0]?.total.amount).toBe(160000 * 2 + 15000 * 2);
  });

  it('같은 패키지 코드는 두 번 만들지 않는다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/packages`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          packageCode: 'BFAST',
          name: '중복',
          amount: 1000,
          calculation: 'PerNight',
          transactionCode: '2000',
        },
      }),
    ).toThrow(/이미 쓰고 있는 패키지 코드/);
  });

  it('알 수 없는 계산 방식은 거절한다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/packages`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          packageCode: 'WEIRD',
          name: '이상',
          amount: 1000,
          calculation: 'PerHour',
          transactionCode: '2000',
        },
      }),
    ).toThrow(/알 수 없는 패키지 계산 방식/);
  });

  it('없는 패키지 수정은 404 로 알린다', () => {
    expect(() =>
      mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/packages/NOPE`, {
        method: 'PATCH',
        hotelId: HOTEL,
        body: { amount: 1 },
      }),
    ).toThrow(/패키지를 찾을 수 없습니다/);
  });
});

describe('모의 OPERA — 요금과 예약', () => {
  const monday = nextDayOfWeek(1, 400);

  function book(body: Record<string, unknown>) {
    return mockOperaRequest<{ roomStay: { total: { amount: number }; ratePlanCode: string } }>(
      `/rsv/v1/hotels/${HOTEL}/reservations`,
      {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          roomStay: {
            arrivalDate: monday,
            departureDate: addDays(monday, 1),
            roomType: 'STDT',
            ...body,
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );
  }

  it('요금 코드에 따라 총액이 다르다', () => {
    const bar = book({ ratePlanCode: 'BAR' });
    const corp = book({ ratePlanCode: 'CORP' });

    expect(corp.roomStay.total.amount).toBeLessThan(bar.roomStay.total.amount);
  });

  it('없는 요금 코드로는 예약을 받지 않는다', () => {
    expect(() => book({ ratePlanCode: 'NOPE' })).toThrow(/알 수 없는 요금 코드/);
  });

  it('중지된 요금 코드로는 예약을 받지 않는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { status: 'Inactive' },
    });

    expect(() => book({ ratePlanCode: 'CORP' })).toThrow(/중지된 요금 코드/);
  });

  it('판매 기간 밖이면 예약을 받지 않는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { sellStartDate: addDays(monday, 10), sellEndDate: addDays(monday, 20) },
    });

    expect(() => book({ ratePlanCode: 'CORP' })).toThrow(/기간에만 팝니다/);
  });

  it('그 요금이 팔지 않는 객실 타입은 거절한다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { baseAmounts: { STDT: 160000 } },
    });

    expect(() =>
      mockOperaRequest(`/rsv/v1/hotels/${HOTEL}/reservations`, {
        method: 'POST',
        hotelId: HOTEL,
        body: {
          roomStay: {
            arrivalDate: monday,
            departureDate: addDays(monday, 1),
            roomType: 'SUIT',
            ratePlanCode: 'CORP',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(/팔지 않습니다/);
  });

  // 중지한 요금이 재고 안내에 남아 있으면 팔 수 없는 값을 보여 준다.
  it('중지된 요금은 조회에 나오지 않는다', () => {
    mockOperaRequest(`/rtp/v1/hotels/${HOTEL}/ratePlans/CORP`, {
      method: 'PATCH',
      hotelId: HOTEL,
      body: { status: 'Inactive' },
    });

    const codes = quote({ startDate: monday, endDate: addDays(monday, 1) }).map(
      (offer) => offer.ratePlanCode,
    );
    expect(codes).not.toContain('CORP');
    expect(codes).toContain('BAR');
  });
});
