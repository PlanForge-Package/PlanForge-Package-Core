import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RESERVATIONS = '/rsv/v1/hotels/SAND01/reservations';

interface Booked {
  reservationId: string;
  sourceOfBusiness: { sourceCode: string; marketCode: string; channelCode?: string };
}

function book(business?: Record<string, string>): Booked {
  return mockOperaRequest<Booked>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: { arrivalDate: day(10), departureDate: day(11), roomType: 'STDT' },
      guest: { givenName: 'A', surname: 'B' },
      ...(business ? { sourceOfBusiness: business } : {}),
    },
  });
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 예약 경로', () => {
  it('지정하지 않으면 직접 예약으로 잡는다', () => {
    const created = book();
    expect(created.sourceOfBusiness.sourceCode).toBe('DIRECT');
    expect(created.sourceOfBusiness.marketCode).toBe('TRANSIENT');
  });

  it('지정한 경로를 그대로 남긴다', () => {
    const created = book({
      sourceCode: 'OTA',
      marketCode: 'LEISURE',
      channelCode: 'EXPEDIA',
    });
    expect(created.sourceOfBusiness).toEqual({
      sourceCode: 'OTA',
      marketCode: 'LEISURE',
      channelCode: 'EXPEDIA',
    });
  });

  // 소문자로 들어온 코드가 다른 채널로 집계되면 안 된다.
  it('코드는 대문자로 맞춘다', () => {
    const created = book({ sourceCode: 'ota', marketCode: 'leisure', channelCode: 'agoda' });
    expect(created.sourceOfBusiness.channelCode).toBe('AGODA');
  });

  // 오타를 통과시키면 "BOOKINGCOM" 과 "BOOKING.COM" 이 다른 채널이 된다.
  it('설정에 없는 채널 코드는 거절한다', () => {
    expect(() => book({ channelCode: 'BOOKING.COM' })).toThrow(/판매 채널/);
  });

  it('설정에 없는 출처 코드는 거절한다', () => {
    expect(() => book({ sourceCode: 'INSTAGRAM' })).toThrow(/예약 출처/);
  });

  it('설정에 없는 시장 코드는 거절한다', () => {
    expect(() => book({ marketCode: 'VIP' })).toThrow(/시장 구분/);
  });
});

describe('모의 OPERA — 경로로 예약 거르기', () => {
  it('출처로 좁힌다', () => {
    book({ sourceCode: 'OTA', channelCode: 'AGODA' });
    book({ sourceCode: 'PHONE' });

    const result = mockOperaRequest<{ reservations: Booked[] }>(RESERVATIONS, {
      hotelId: 'SAND01',
      query: { sourceCode: 'PHONE' },
    });
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.sourceOfBusiness.sourceCode).toBe('PHONE');
  });

  it('채널로 좁힌다', () => {
    book({ sourceCode: 'OTA', channelCode: 'AGODA' });
    book({ sourceCode: 'OTA', channelCode: 'EXPEDIA' });

    const result = mockOperaRequest<{ reservations: Booked[] }>(RESERVATIONS, {
      hotelId: 'SAND01',
      query: { channelCode: 'EXPEDIA' },
    });
    expect(result.reservations).toHaveLength(1);
  });
});
