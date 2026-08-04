import { beforeEach, describe, expect, it } from 'vitest';
import { OperaApiError } from './errors.js';
import { mockOperaRequest, resetMockStore } from './mock-transport.js';

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface BlockShape {
  blockId: string;
  blockCode: string;
  blockStatus: string;
  roomTypeAllocations: Array<{
    date: string;
    roomType: string;
    roomsBlocked: number;
    roomsPickedUp: number;
    ratePlanCode?: string;
    amount?: number;
  }>;
}

const BLOCKS = '/blk/v1/hotels/SAND01/blocks';

function createBlock(overrides: Record<string, unknown> = {}): BlockShape {
  return mockOperaRequest<BlockShape>(BLOCKS, {
    method: 'POST',
    hotelId: 'SAND01',
    body: {
      blockCode: 'TESTB',
      blockName: '테스트 단체',
      startDate: day(30),
      endDate: day(32),
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 5 }],
      ...overrides,
    },
  });
}

beforeEach(() => {
  resetMockStore();
});

describe('모의 OPERA — 블록 생성', () => {
  it('객실 타입별 수량을 일자별로 펼친다', () => {
    const created = createBlock();
    // 2박 × 객실 타입 1개
    expect(created.roomTypeAllocations).toHaveLength(2);
    expect(created.roomTypeAllocations.map((a) => a.date)).toEqual([day(30), day(31)]);
    expect(created.roomTypeAllocations.every((a) => a.roomsBlocked === 5)).toBe(true);
  });

  it('종료일이 시작일보다 앞서면 거절한다', () => {
    expect(() => createBlock({ startDate: day(32), endDate: day(30) })).toThrow(/종료일/);
  });

  it('알 수 없는 객실 타입은 거절한다', () => {
    expect(() =>
      createBlock({ roomTypeAllocations: [{ roomType: 'NOPE', roomsBlocked: 1 }] }),
    ).toThrow(OperaApiError);
  });

  // 코드가 겹치면 예약이 어느 블록에서 빠지는지 판단할 수 없다.
  it('같은 호텔에 같은 블록 코드는 두 번 만들 수 없다', () => {
    createBlock({ blockCode: 'DUPE' });
    expect(() => createBlock({ blockCode: 'DUPE' })).toThrow(/이미 쓰고 있는/);
  });
});

describe('모의 OPERA — 블록 협의 요금', () => {
  it('협의 요금을 넣으면 일자마다 그 값으로 잡힌다', () => {
    const created = createBlock({
      blockCode: 'NEGO',
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 5, amount: 120000 }],
    });

    expect(created.roomTypeAllocations.every((a) => a.amount === 120000)).toBe(true);
  });

  it('협의 요금이 없으면 요금 코드의 계산을 따른다', () => {
    const created = createBlock({
      blockCode: 'BYPLAN',
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 5, ratePlanCode: 'CORP' }],
    });

    // CORP 는 STDT 를 160,000 에 판다.
    expect(created.roomTypeAllocations.every((a) => a.amount === 160000)).toBe(true);
  });

  it('없는 요금 코드로는 잡을 수 없다', () => {
    expect(() =>
      createBlock({
        blockCode: 'BADPLAN',
        roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 1, ratePlanCode: 'NOPE' }],
      }),
    ).toThrow(/알 수 없는 요금 코드/);
  });

  // 그 요금으로 팔지 않는 타입이면 값을 매길 수 없다.
  it('요금이 팔지 않는 객실 타입은 협의 요금을 요구한다', () => {
    mockOperaRequest('/rtp/v1/hotels/SAND01/ratePlans/CORP', {
      method: 'PATCH',
      hotelId: 'SAND01',
      body: { baseAmounts: { STDT: 160000 } },
    });

    expect(() =>
      createBlock({
        blockCode: 'NOSUIT',
        roomTypeAllocations: [{ roomType: 'SUIT', roomsBlocked: 1, ratePlanCode: 'CORP' }],
      }),
    ).toThrow(/협의 요금을 넣어/);
  });

  it('블록에서 빠져나간 예약은 협의 요금으로 잡힌다', () => {
    createBlock({
      blockCode: 'PICKRATE',
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 5, amount: 100000 }],
    });

    const created = mockOperaRequest<{ roomStay: { total: { amount: number } } }>(
      '/rsv/v1/hotels/SAND01/reservations',
      {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: day(30),
            departureDate: day(32),
            roomType: 'STDT',
            blockCode: 'PICKRATE',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      },
    );

    expect(created.roomStay.total.amount).toBe(200000);
  });

  it('수정으로 협의 요금을 조정할 수 있다', () => {
    const created = createBlock({
      blockCode: 'ADJUST',
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 5, amount: 100000 }],
    });

    const updated = mockOperaRequest<BlockShape>(`${BLOCKS}/${created.blockId}`, {
      method: 'PATCH',
      hotelId: 'SAND01',
      body: { rates: [{ roomType: 'STDT', amount: 90000 }] },
    });

    expect(updated.roomTypeAllocations.every((a) => a.amount === 90000)).toBe(true);
  });

  it('블록이 잡지 않은 객실 타입은 조정할 수 없다', () => {
    const created = createBlock({ blockCode: 'NOTHERE' });

    expect(() =>
      mockOperaRequest(`${BLOCKS}/${created.blockId}`, {
        method: 'PATCH',
        hotelId: 'SAND01',
        body: { rates: [{ roomType: 'SUIT', amount: 90000 }] },
      }),
    ).toThrow(/잡지 않은 객실 타입/);
  });
});

describe('모의 OPERA — 블록 픽업', () => {
  it('블록 코드로 예약하면 해당 일자의 픽업이 오른다', () => {
    const created = createBlock({ blockCode: 'PICKUP' });

    mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: {
          arrivalDate: day(30),
          departureDate: day(31),
          roomType: 'STDT',
          blockCode: 'PICKUP',
        },
        guest: { givenName: 'A', surname: 'B' },
      },
    });

    const after = mockOperaRequest<BlockShape>(`${BLOCKS}/${created.blockId}`, {
      hotelId: 'SAND01',
    });
    const first = after.roomTypeAllocations.find((a) => a.date === day(30));
    const second = after.roomTypeAllocations.find((a) => a.date === day(31));

    expect(first?.roomsPickedUp).toBe(1);
    // 1박짜리 예약이므로 둘째 날은 건드리지 않는다.
    expect(second?.roomsPickedUp).toBe(0);
  });

  it('룸리스트는 블록 코드로 예약을 걸러 준다', () => {
    createBlock({ blockCode: 'ROOMLIST' });

    mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: {
          arrivalDate: day(30),
          departureDate: day(31),
          roomType: 'STDT',
          blockCode: 'ROOMLIST',
        },
        guest: { givenName: 'Group', surname: 'Guest' },
      },
    });

    const list = mockOperaRequest<{ reservations: Array<{ guest: { surname: string } }> }>(
      '/rsv/v1/hotels/SAND01/reservations',
      { hotelId: 'SAND01', query: { blockCode: 'ROOMLIST' } },
    );

    expect(list.reservations).toHaveLength(1);
    expect(list.reservations[0]?.guest.surname).toBe('Guest');
  });

  // 룸리스트에는 보이는데 픽업은 0 이면 컷오프 판단 근거가 사라진다.
  it('블록이 잡지 않은 객실 타입으로는 뺄 수 없다', () => {
    createBlock({ blockCode: 'ONLYSTD' }); // STDT 만 잡는다

    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: day(30),
            departureDate: day(31),
            roomType: 'SUIT',
            blockCode: 'ONLYSTD',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(/잡아 두지 않았습니다/);
  });

  it('블록 기간을 벗어난 날짜로는 뺄 수 없다', () => {
    createBlock({ blockCode: 'RANGE' }); // day(30)~day(32)

    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: day(31),
            departureDate: day(33),
            roomType: 'STDT',
            blockCode: 'RANGE',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(/잡아 두지 않았습니다/);
  });

  it('할당을 다 쓰면 더 뺄 수 없다', () => {
    createBlock({
      blockCode: 'FULL',
      roomTypeAllocations: [{ roomType: 'STDT', roomsBlocked: 1 }],
    });

    const book = () =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: day(30),
            departureDate: day(31),
            roomType: 'STDT',
            blockCode: 'FULL',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      });

    book();
    expect(book).toThrow(/소진되었습니다/);
  });

  it('없는 블록 코드로는 예약할 수 없다', () => {
    expect(() =>
      mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
        method: 'POST',
        hotelId: 'SAND01',
        body: {
          roomStay: {
            arrivalDate: day(30),
            departureDate: day(31),
            roomType: 'STDT',
            blockCode: 'GHOST',
          },
          guest: { givenName: 'A', surname: 'B' },
        },
      }),
    ).toThrow(/알 수 없는 블록 코드/);
  });
});

describe('모의 OPERA — 블록 수정', () => {
  it('상태와 컷오프를 바꾼다', () => {
    const created = createBlock({ blockCode: 'UPD' });
    const updated = mockOperaRequest<BlockShape & { cutoffDate?: string }>(
      `${BLOCKS}/${created.blockId}`,
      {
        method: 'PATCH',
        hotelId: 'SAND01',
        body: { blockStatus: 'Definite', cutoffDate: day(20) },
      },
    );
    expect(updated.blockStatus).toBe('Definite');
    expect(updated.cutoffDate).toBe(day(20));
  });

  // 예약이 이미 빠져나갔는데 블록을 지우면 그 예약의 요금 근거가 사라진다.
  it('픽업이 있는 블록은 취소할 수 없다', () => {
    const created = createBlock({ blockCode: 'HASPICK' });
    mockOperaRequest('/rsv/v1/hotels/SAND01/reservations', {
      method: 'POST',
      hotelId: 'SAND01',
      body: {
        roomStay: {
          arrivalDate: day(30),
          departureDate: day(31),
          roomType: 'STDT',
          blockCode: 'HASPICK',
        },
        guest: { givenName: 'A', surname: 'B' },
      },
    });

    expect(() =>
      mockOperaRequest(`${BLOCKS}/${created.blockId}`, {
        method: 'PATCH',
        hotelId: 'SAND01',
        body: { blockStatus: 'Cancelled' },
      }),
    ).toThrow(/픽업된 예약/);
  });

  it('없는 블록은 404 로 알린다', () => {
    expect(() => mockOperaRequest(`${BLOCKS}/NOPE`, { hotelId: 'SAND01' })).toThrow(
      /블록을 찾을 수 없습니다/,
    );
  });
});

describe('모의 OPERA — 블록 목록', () => {
  it('상태로 거를 수 있다', () => {
    const all = mockOperaRequest<{ blocks: BlockShape[] }>(BLOCKS, { hotelId: 'SAND01' });
    expect(all.blocks.length).toBeGreaterThan(1);

    const definite = mockOperaRequest<{ blocks: BlockShape[] }>(BLOCKS, {
      hotelId: 'SAND01',
      query: { blockStatus: 'Definite' },
    });
    expect(definite.blocks.every((b) => b.blockStatus === 'Definite')).toBe(true);
    expect(definite.blocks.length).toBeLessThan(all.blocks.length);
  });
});
