import { beforeEach, describe, expect, it } from 'vitest';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RESERVATIONS = '/rsv/v1/hotels/SAND01/reservations';
const PROFILES = '/crm/v1/profiles';

interface Created {
  reservationId: string;
  guest: { profileId: string };
}

function book(surname: string): Created {
  return mockOperaRequest<Created>(RESERVATIONS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      roomStay: { arrivalDate: day(10), departureDate: day(11), roomType: 'STDT' },
      guest: { givenName: 'A', surname },
    },
  });
}

function merge(sourceId: string, targetProfileId: string) {
  return mockOperaRequest<{ profileId: string }>(`${PROFILES}/${sourceId}/merge`, {
    method: 'POST',
    hotelId: 'SAND01',
    body: { targetProfileId },
  });
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 프로필', () => {
  it('예약을 만들면 프로필도 함께 생긴다', () => {
    const created = book('Hong');
    const profile = mockOperaRequest<{ surname: string }>(
      `${PROFILES}/${created.guest.profileId}`,
      { hotelId: 'SAND01' },
    );
    expect(profile.surname).toBe('Hong');
  });

  it('없는 프로필은 404 로 알린다', () => {
    expect(() => mockOperaRequest(`${PROFILES}/NOPE`, { hotelId: 'SAND01' })).toThrow(
      /프로필을 찾을 수 없습니다/,
    );
  });
});

describe('모의 OPERA — 기존 프로필로 예약', () => {
  // 다른 번호를 지어내면 호출자가 지정한 것과 다른 프로필에 예약이 붙는다.
  it('모르는 프로필 ID 라도 그대로 쓴다', () => {
    const created = mockOperaRequest<Created>(RESERVATIONS, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: { arrivalDate: day(10), departureDate: day(11), roomType: 'STDT' },
        guest: { profileId: 'PRF-EXTERNAL', givenName: 'A', surname: 'Hong' },
      },
    });
    expect(created.guest.profileId).toBe('PRF-EXTERNAL');
  });

  // 예약 한 건 때문에 손님 이름이 바뀌면 안 된다. 프로필이 기록의 원천이다.
  it('아는 프로필이면 그 프로필의 이름을 쓴다', () => {
    const first = book('Hong');
    const second = mockOperaRequest<Created & { guest: { surname: string } }>(RESERVATIONS, {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: { arrivalDate: day(10), departureDate: day(11), roomType: 'STDT' },
        guest: { profileId: first.guest.profileId, givenName: 'X', surname: 'WRONG' },
      },
    });
    expect(second.guest.surname).toBe('Hong');
  });

  it('병합된 프로필로는 예약할 수 없다', () => {
    const a = book('Hong');
    const b = book('Hong');
    const sourceId = a.guest.profileId;
    merge(sourceId, b.guest.profileId);

    expect(() =>
      mockOperaRequest(RESERVATIONS, {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: { arrivalDate: day(10), departureDate: day(11), roomType: 'STDT' },
          guest: { profileId: sourceId, givenName: 'A', surname: 'Hong' },
        },
      }),
    ).toThrow(/병합된 프로필로는/);
  });
});

describe('모의 OPERA — 프로필 병합', () => {
  // 원본을 지우면 그 프로필을 쓰던 예약의 게스트가 사라진다.
  it('예약을 정본으로 옮기고 원본은 남긴다', () => {
    const first = book('Hong');
    const second = book('Hong');

    merge(first.guest.profileId, second.guest.profileId);

    const moved = mockOperaRequest<{ guest: { profileId: string } }>(
      `${RESERVATIONS}/${first.reservationId}`,
      { hotelId: 'SAND01' },
    );
    expect(moved.guest.profileId).toBe(second.guest.profileId);

    const source = mockOperaRequest<{ mergedIntoId?: string }>(
      `${PROFILES}/${first.guest.profileId}`,
      { hotelId: 'SAND01' },
    );
    expect(source.mergedIntoId).toBe(second.guest.profileId);
  });

  it('같은 프로필끼리는 병합할 수 없다', () => {
    const created = book('Hong');
    expect(() => merge(created.guest.profileId, created.guest.profileId)).toThrow(/같은 프로필/);
  });

  it('이미 병합된 프로필은 다시 병합할 수 없다', () => {
    const a = book('Hong');
    const b = book('Hong');
    const c = book('Hong');

    merge(a.guest.profileId, b.guest.profileId);
    expect(() => merge(a.guest.profileId, c.guest.profileId)).toThrow(/이미 병합된/);
  });

  it('없는 프로필은 404 로 알린다', () => {
    const created = book('Hong');
    expect(() => merge(created.guest.profileId, 'NOPE')).toThrow(/찾을 수 없습니다/);
  });
});
