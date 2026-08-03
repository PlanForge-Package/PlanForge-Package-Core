import { OperaApiError } from './errors.js';
import type { OperaRequestOptions } from './client.js';

/**
 * OHIP 모의 전송 계층.
 *
 * 구독 스펙과 자격 증명이 없어도 FE·BE 까지 전 구간을 개발·검증하기 위해 둔다.
 * 여기서 돌려주는 것은 **OPERA 형태의 원본 응답**이고, 라우트의 매핑 코드는
 * live 와 똑같이 태운다. 나중에 실제 연동으로 바꿀 때 달라지는 것은 전송 계층뿐이다.
 *
 * 주의: 여기 담긴 필드 이름은 일반적인 OHIP 규약을 따른 **추정치**다. 실제 구독
 * 스펙을 받으면 이 파일과 라우트의 매핑을 함께 맞춰야 한다.
 */

interface MockReservation {
  reservationId: string;
  confirmationNumber: string;
  hotelId: string;
  reservationStatus: string;
  roomStay: {
    arrivalDate: string;
    departureDate: string;
    roomType: string;
    ratePlanCode: string;
    roomId?: string;
    adultCount: number;
    childCount: number;
    total?: { amount: number; currencyCode: string };
    /** 단체 블록에서 빠져나온 예약이면 그 블록 코드 */
    blockCode?: string;
  };
  guest: { profileId: string; givenName: string; surname: string; email?: string };
  sourceOfBusiness: { sourceCode: string; marketCode: string; channelCode?: string };
}

/**
 * OPERA 가 아는 예약 경로 코드.
 *
 * 실제로는 호텔마다 설정에서 정하지만, 아무 문자열이나 받으면 오타가 그대로
 * 집계에 들어가 "BOOKINGCOM" 과 "BOOKING.COM" 이 다른 채널이 된다.
 */
const SOURCE_CODES = ['DIRECT', 'PHONE', 'WALKIN', 'OTA', 'GDS', 'CORPORATE'];
const MARKET_CODES = ['TRANSIENT', 'CORPORATE', 'GROUP', 'LEISURE', 'GOVERNMENT'];
const CHANNEL_CODES = ['WEB', 'MOBILE', 'BOOKINGCOM', 'EXPEDIA', 'AGODA', 'YANOLJA', 'FRONTDESK'];

/** 모의 저장소. 프로세스가 살아 있는 동안만 유지된다. */
const store = new Map<string, MockReservation>();

/**
 * 새 예약 번호의 시작점.
 *
 * 시드가 쓰는 1001·1002 보다 위에서 시작해야 한다. 겹치면 새로 만든 예약이
 * 시드 예약을 덮어써 재고 계산과 목록이 조용히 어긋난다.
 */
const SEQUENCE_START = 2000;
let sequence = SEQUENCE_START;

function seed(): void {
  if (store.size > 0) return;

  const base: MockReservation[] = [
    {
      reservationId: 'OPERA-1001',
      confirmationNumber: 'OP1001',
      hotelId: 'SAND01',
      reservationStatus: 'Reserved',
      roomStay: {
        arrivalDate: dayOffset(1),
        departureDate: dayOffset(3),
        roomType: 'DLXK',
        ratePlanCode: 'BAR',
        adultCount: 2,
        childCount: 0,
        total: { amount: 480000, currencyCode: 'KRW' },
      },
      guest: {
        profileId: 'PRF-9001',
        givenName: 'Jaeho',
        surname: 'Kang',
        email: 'jaeho.kang@example.com',
      },
      sourceOfBusiness: {
        sourceCode: 'OTA',
        marketCode: 'LEISURE',
        channelCode: 'BOOKINGCOM',
      },
    },
    {
      reservationId: 'OPERA-1002',
      confirmationNumber: 'OP1002',
      hotelId: 'SAND01',
      reservationStatus: 'Confirmed',
      roomStay: {
        arrivalDate: dayOffset(0),
        departureDate: dayOffset(2),
        roomType: 'STDT',
        ratePlanCode: 'CORP',
        adultCount: 1,
        childCount: 0,
        total: { amount: 380000, currencyCode: 'KRW' },
      },
      guest: {
        profileId: 'PRF-9002',
        givenName: 'Mina',
        surname: 'Seo',
        email: 'mina.seo@example.com',
      },
      sourceOfBusiness: {
        sourceCode: 'CORPORATE',
        marketCode: 'CORPORATE',
        channelCode: 'FRONTDESK',
      },
    },
  ];

  for (const reservation of base) {
    store.set(reservation.reservationId, reservation);
    rememberProfile(reservation.guest);
  }
}

function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** OPERA 가 허용하는 객실 상태. */
const ROOM_STATUSES = ['Clean', 'Dirty', 'Inspected', 'OutOfOrder', 'OutOfService'];

/** 객실 타입별 기준 요금. 실제로는 OPERA 의 요금 엔진이 정한다. */
const RATES: Record<string, number> = { STDT: 190000, DLXK: 240000, SUIT: 400000 };
const ROOM_TYPE_NAMES: Record<string, string> = {
  STDT: 'Standard Twin',
  DLXK: 'Deluxe King',
  SUIT: 'Suite',
};

function nights(arrival: string, departure: string): number {
  const from = Date.parse(`${arrival}T00:00:00Z`);
  const to = Date.parse(`${departure}T00:00:00Z`);
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

/** 모의 객실 상태. 실제로는 OPERA 가 들고 있다. */
const rooms = new Map<string, { roomStatus: string; occupied: boolean }>();

interface MockBlockAllocation {
  date: string;
  roomType: string;
  roomsBlocked: number;
  roomsPickedUp: number;
  ratePlanCode?: string;
  amount?: number;
}

interface MockBlock {
  blockId: string;
  blockCode: string;
  blockName: string;
  hotelId: string;
  blockStatus: string;
  startDate: string;
  endDate: string;
  cutoffDate?: string;
  currencyCode: string;
  roomTypeAllocations: MockBlockAllocation[];
}

const blocks = new Map<string, MockBlock>();

/**
 * 호텔별 영업일.
 *
 * 모의 모드에서는 야간 감사가 돌지 않으므로 달력 날짜와 같게 둔다. 실제로는
 * 마감 전까지 어제로 남아 있고, 그 차이가 매출이 붙는 날짜를 정한다.
 */
const businessDates = new Map<string, string>();

interface MockProfile {
  profileId: string;
  givenName?: string;
  surname?: string;
  email?: string;
  mergedIntoId?: string;
}

/**
 * 모의 프로필 저장소.
 *
 * 예약을 만들 때 함께 채운다. 병합을 검증하려면 예약과 별개로 프로필이 존재해야
 * 하기 때문이다.
 */
const profiles = new Map<string, MockProfile>();

function rememberProfile(guest: MockReservation['guest']): void {
  if (!guest.profileId || profiles.has(guest.profileId)) return;
  profiles.set(guest.profileId, {
    profileId: guest.profileId,
    givenName: guest.givenName,
    surname: guest.surname,
    email: guest.email,
  });
}

/** 블록 번호도 예약과 마찬가지로 시드와 겹치지 않는 지점에서 시작한다. */
const BLOCK_SEQUENCE_START = 500;
let blockSequence = BLOCK_SEQUENCE_START;

/** 블록이 재고를 잡는 단위는 '박'이다. 출발일 당일은 포함하지 않는다. */
function stayDates(startDate: string, endDate: string): string[] {
  const count = nights(startDate, endDate);
  return Array.from({ length: count }, (_, i) => addDays(startDate, i));
}

function seedBlocks(): void {
  if (blocks.size > 0) return;

  const base: MockBlock[] = [
    {
      blockId: 'BLK-1001',
      blockCode: 'SPGRP',
      blockName: '스페이스플래닝 워크숍',
      hotelId: 'SAND01',
      blockStatus: 'Definite',
      startDate: dayOffset(7),
      endDate: dayOffset(9),
      cutoffDate: dayOffset(3),
      currencyCode: 'KRW',
      roomTypeAllocations: stayDates(dayOffset(7), dayOffset(9)).flatMap((date) => [
        { date, roomType: 'STDT', roomsBlocked: 12, roomsPickedUp: 5, ratePlanCode: 'CORP' },
        { date, roomType: 'DLXK', roomsBlocked: 4, roomsPickedUp: 1, ratePlanCode: 'CORP' },
      ]),
    },
    {
      blockId: 'BLK-1002',
      blockCode: 'WEDKM',
      blockName: '김·문 웨딩 하객',
      hotelId: 'SAND01',
      blockStatus: 'Tentative',
      startDate: dayOffset(21),
      endDate: dayOffset(22),
      cutoffDate: dayOffset(14),
      currencyCode: 'KRW',
      roomTypeAllocations: stayDates(dayOffset(21), dayOffset(22)).flatMap((date) => [
        { date, roomType: 'DLXK', roomsBlocked: 8, roomsPickedUp: 0, ratePlanCode: 'BAR' },
      ]),
    },
  ];

  for (const block of base) {
    blocks.set(block.blockId, block);
  }
}

/**
 * 이 예약을 블록에서 뺄 수 있는지 확인한다.
 *
 * 잡아 두지 않은 객실 타입이나 기간을 그냥 통과시키면 룸리스트에는 예약이
 * 보이는데 픽업은 0 으로 남는다. 두 숫자가 어긋나면 컷오프 때 남은 객실을
 * 풀지 판단할 근거가 사라진다. 그래서 거절한다.
 */
function assertPickupPossible(
  block: MockBlock,
  roomType: string,
  arrival: string,
  departure: string,
): void {
  for (const date of stayDates(arrival, departure)) {
    const slot = block.roomTypeAllocations.find((a) => a.date === date && a.roomType === roomType);
    if (!slot) {
      throw new OperaApiError(
        400,
        { detail: 'BLOCK_NO_ALLOTMENT' },
        `블록 ${block.blockCode} 는 ${date} 에 ${roomType} 객실을 잡아 두지 않았습니다.`,
      );
    }
    if (slot.roomsPickedUp >= slot.roomsBlocked) {
      throw new OperaApiError(
        400,
        { detail: 'BLOCK_EXHAUSTED' },
        `블록 ${block.blockCode} 의 ${date} ${roomType} 할당이 모두 소진되었습니다.`,
      );
    }
  }
}

/**
 * 블록 코드로 예약이 들어오면 해당 일자·객실 타입의 픽업을 올린다.
 *
 * 픽업이 늘지 않으면 블록이 얼마나 소진됐는지 알 수 없다. 실제 OPERA 도
 * 예약 시점에 갱신한다. 호출 전에 assertPickupPossible 로 걸러 둔다.
 */
function applyPickup(block: MockBlock, roomType: string, arrival: string, departure: string): void {
  for (const date of stayDates(arrival, departure)) {
    const slot = block.roomTypeAllocations.find((a) => a.date === date && a.roomType === roomType);
    if (slot) slot.roomsPickedUp += 1;
  }
}

function seedRooms(): void {
  if (rooms.size > 0) return;
  const base: Array<[string, string, boolean]> = [
    ['1101', 'Clean', false],
    ['1102', 'Dirty', false],
    ['1103', 'Inspected', false],
    ['1201', 'Clean', false],
    ['1202', 'Clean', false],
    ['1203', 'Inspected', true],
    ['1501', 'Clean', false],
    ['1502', 'OutOfOrder', false],
  ];
  for (const [roomId, roomStatus, occupied] of base) {
    rooms.set(roomId, { roomStatus, occupied });
  }
}

/**
 * 설정에 없는 코드는 거절한다.
 *
 * 통과시키면 오타가 그대로 집계에 들어가 "BOOKINGCOM" 과 "BOOKING.COM" 이 서로
 * 다른 채널이 된다. 채널별 실적은 그 순간부터 신뢰할 수 없다.
 */
function assertCode(allowed: string[], value: string, label: string): void {
  if (!allowed.includes(value)) {
    throw new OperaApiError(
      400,
      { detail: 'INVALID_CODE' },
      `알 수 없는 ${label} 코드입니다: ${value}. 가능한 값: ${allowed.join(', ')}`,
    );
  }
}

/** 노쇼로 바꿀 수 있는 출발 상태. 이미 들어온 손님을 안 왔다고 할 수는 없다. */
const NO_SHOW_FROM = ['Reserved', 'Confirmed', 'Waitlisted'];

function assertNoShowAllowed(reservation: MockReservation, businessDate: string): void {
  if (!NO_SHOW_FROM.includes(reservation.reservationStatus)) {
    throw new OperaApiError(
      400,
      { detail: 'INVALID_STATUS_TRANSITION' },
      `현재 상태(${reservation.reservationStatus})에서는 노쇼 처리할 수 없습니다.`,
    );
  }

  // 아직 도착일이 오지 않은 예약을 노쇼로 찍으면 판매 가능한 재고가 사라지고
  // 노쇼 수수료 근거도 없다. 영업일이 도착일에 닿아야 판단할 수 있다.
  if (reservation.roomStay.arrivalDate > businessDate) {
    throw new OperaApiError(
      400,
      { detail: 'ARRIVAL_NOT_DUE' },
      `도착일(${reservation.roomStay.arrivalDate})이 지나지 않아 노쇼로 처리할 수 없습니다.`,
    );
  }
}

/**
 * 모의 응답은 항상 복사본이다.
 *
 * 저장된 객체를 그대로 돌려주면 호출자가 손대는 순간 저장소가 조용히 바뀌고,
 * 뒤에 일어난 변경이 앞서 받은 응답에도 소급 반영된다. 실제 HTTP 응답은 그런
 * 식으로 움직이지 않으므로 여기서도 끊어 둔다.
 */
export function mockOperaRequest<T>(path: string, options: OperaRequestOptions): T {
  return structuredClone(handleMockRequest<T>(path, options));
}

function handleMockRequest<T>(path: string, options: OperaRequestOptions): T {
  seed();
  seedRooms();
  seedBlocks();

  const method = options.method ?? 'GET';
  const query = options.query ?? {};
  const body = (options.body ?? {}) as Record<string, unknown>;
  const hotelId = options.hotelId ?? 'SAND01';

  // --- 가용 재고 ---------------------------------------------------------
  if (method === 'GET' && /\/availability$/.test(path)) {
    const arrival = String(query.startDate ?? dayOffset(0));
    const departure = String(query.endDate ?? dayOffset(1));
    const stayNights = nights(arrival, departure);

    const sold = [...store.values()].filter(
      (r) =>
        r.hotelId === hotelId &&
        !['Cancelled', 'NoShow'].includes(r.reservationStatus) &&
        r.roomStay.arrivalDate < departure &&
        r.roomStay.departureDate > arrival,
    );

    const roomTypes = query.roomType ? [String(query.roomType)] : Object.keys(RATES);
    return {
      roomStays: roomTypes.map((code) => {
        const soldForType = sold.filter((r) => r.roomStay.roomType === code).length;
        const inventory = code === 'SUIT' ? 4 : 10;
        return {
          roomType: code,
          roomTypeName: ROOM_TYPE_NAMES[code],
          available: Math.max(0, inventory - soldForType),
          ratePlanCode: 'BAR',
          total: { amount: (RATES[code] ?? 0) * stayNights, currencyCode: 'KRW' },
        };
      }),
    } as T;
  }

  // --- 요금 --------------------------------------------------------------
  if (method === 'GET' && /\/rates$/.test(path)) {
    const arrival = String(query.startDate ?? dayOffset(0));
    const departure = String(query.endDate ?? dayOffset(1));
    const stayNights = nights(arrival, departure);

    return {
      ratePlans: Object.keys(RATES).map((code) => ({
        ratePlanCode: code === 'SUIT' ? 'CORP' : 'BAR',
        roomType: code,
        roomTypeName: ROOM_TYPE_NAMES[code],
        currencyCode: 'KRW',
        // 하루치 단가와 총액을 함께 준다. OPERA 도 기간 요금을 이렇게 내려준다.
        nightlyRates: Array.from({ length: stayNights }, (_, i) => ({
          date: addDays(arrival, i),
          amount: RATES[code],
        })),
        total: { amount: (RATES[code] ?? 0) * stayNights, currencyCode: 'KRW' },
      })),
    } as T;
  }

  // --- 하우스키핑: 객실 상태 --------------------------------------------
  if (method === 'GET' && /\/hsk\/v1\/hotels\/[^/]+\/rooms$/.test(path)) {
    const wanted = query.roomStatus ? String(query.roomStatus) : undefined;
    return {
      rooms: [...rooms.entries()]
        .filter(([, room]) => !wanted || room.roomStatus === wanted)
        .map(([roomId, room]) => ({ hotelId, roomId, ...room })),
    } as T;
  }

  const statusMatch = /\/hsk\/v1\/hotels\/[^/]+\/rooms\/([^/]+)\/status$/.exec(path);
  if (statusMatch && (method === 'PUT' || method === 'PATCH')) {
    const roomId = decodeURIComponent(statusMatch[1] ?? '');
    const room = rooms.get(roomId);
    if (!room) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `객실을 찾을 수 없습니다: ${roomId}`);
    }

    const next = String(body.roomStatus ?? '');
    if (!ROOM_STATUSES.includes(next)) {
      throw new OperaApiError(400, { detail: 'INVALID_STATUS' }, `알 수 없는 객실 상태: ${next}`);
    }

    // 재실 중인 객실을 판매 불가로 돌리면 재고와 실제가 어긋난다. OPERA 도 막는다.
    if (room.occupied && (next === 'OutOfOrder' || next === 'OutOfService')) {
      throw new OperaApiError(
        400,
        { detail: 'ROOM_OCCUPIED' },
        '재실 중인 객실은 판매 불가 상태로 변경할 수 없습니다.',
      );
    }

    const updated = { ...room, roomStatus: next };
    rooms.set(roomId, updated);
    return { hotelId, roomId, ...updated } as T;
  }

  // --- 영업일 ------------------------------------------------------------
  if (method === 'GET' && /\/lov\/v1\/hotels\/[^/]+\/businessDate$/.test(path)) {
    return {
      hotelId,
      businessDate: businessDates.get(hotelId) ?? dayOffset(0),
      currentDate: dayOffset(0),
    } as T;
  }

  // --- 프로필 ------------------------------------------------------------
  const profileMergeMatch = /\/crm\/v1\/profiles\/([^/]+)\/merge$/.exec(path);
  if (profileMergeMatch && method === 'POST') {
    const sourceId = decodeURIComponent(profileMergeMatch[1] ?? '');
    const targetId = String(body.targetProfileId ?? '');

    const source = profiles.get(sourceId);
    const target = profiles.get(targetId);
    if (!source) {
      throw new OperaApiError(
        404,
        { detail: 'NOT_FOUND' },
        `프로필을 찾을 수 없습니다: ${sourceId}`,
      );
    }
    if (!target) {
      throw new OperaApiError(
        404,
        { detail: 'NOT_FOUND' },
        `프로필을 찾을 수 없습니다: ${targetId}`,
      );
    }
    if (sourceId === targetId) {
      throw new OperaApiError(
        400,
        { detail: 'SAME_PROFILE' },
        '같은 프로필끼리는 병합할 수 없습니다.',
      );
    }
    if (source.mergedIntoId || target.mergedIntoId) {
      throw new OperaApiError(
        400,
        { detail: 'ALREADY_MERGED' },
        '이미 병합된 프로필이 포함되어 있습니다.',
      );
    }

    // 예약의 프로필을 정본으로 옮긴다. 원본은 지우지 않는다 — 지우면 예약의
    // 게스트가 사라지고, 남겨 두면 어느 쪽이 정본인지 알 수 있다.
    for (const reservation of store.values()) {
      if (reservation.guest.profileId === sourceId) {
        reservation.guest = { ...reservation.guest, profileId: targetId };
      }
    }

    const merged: MockProfile = {
      ...target,
      givenName: target.givenName ?? source.givenName,
      surname: target.surname ?? source.surname,
      email: target.email ?? source.email,
    };
    profiles.set(targetId, merged);
    profiles.set(sourceId, { ...source, mergedIntoId: targetId });

    return merged as T;
  }

  const profileMatch = /\/crm\/v1\/profiles\/([^/]+)$/.exec(path);
  if (profileMatch && method === 'GET') {
    const profileId = decodeURIComponent(profileMatch[1] ?? '');
    const profile = profiles.get(profileId);
    if (!profile) {
      throw new OperaApiError(
        404,
        { detail: 'NOT_FOUND' },
        `프로필을 찾을 수 없습니다: ${profileId}`,
      );
    }
    return profile as T;
  }

  // --- 단체 블록 ---------------------------------------------------------
  if (method === 'GET' && /\/blk\/v1\/hotels\/[^/]+\/blocks$/.test(path)) {
    let items = [...blocks.values()].filter((b) => b.hotelId === hotelId);

    if (query.blockStatus) {
      items = items.filter((b) => b.blockStatus === query.blockStatus);
    }
    if (query.startDate) {
      items = items.filter((b) => b.endDate >= String(query.startDate));
    }

    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 50);
    items.sort((a, b) => a.startDate.localeCompare(b.startDate));

    return { blocks: items.slice(offset, offset + limit), totalResults: items.length } as T;
  }

  if (method === 'POST' && /\/blk\/v1\/hotels\/[^/]+\/blocks$/.test(path)) {
    const startDate = String(body.startDate ?? dayOffset(7));
    const endDate = String(body.endDate ?? dayOffset(8));

    if (endDate <= startDate) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_DATES' },
        '종료일은 시작일보다 뒤여야 합니다.',
      );
    }

    const code = String(body.blockCode ?? '').toUpperCase();
    if ([...blocks.values()].some((b) => b.hotelId === hotelId && b.blockCode === code)) {
      throw new OperaApiError(
        409,
        { detail: 'DUPLICATE_CODE' },
        `이미 쓰고 있는 블록 코드입니다: ${code}`,
      );
    }

    const allocations = (body.roomTypeAllocations ?? []) as Array<Record<string, unknown>>;
    for (const slot of allocations) {
      const roomType = String(slot.roomType ?? '');
      if (!(roomType in RATES)) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_ROOM_TYPE' },
          `알 수 없는 객실 타입: ${roomType}`,
        );
      }
    }

    blockSequence += 1;
    const created: MockBlock = {
      blockId: `BLK-${blockSequence}`,
      blockCode: code,
      blockName: String(body.blockName ?? ''),
      hotelId,
      blockStatus: String(body.blockStatus ?? 'Tentative'),
      startDate,
      endDate,
      cutoffDate: body.cutoffDate ? String(body.cutoffDate) : undefined,
      currencyCode: 'KRW',
      // 요청은 객실 타입별 수량만 주고, 일자별로 펼치는 것은 OPERA 의 몫이다.
      roomTypeAllocations: stayDates(startDate, endDate).flatMap((date) =>
        allocations.map((slot) => ({
          date,
          roomType: String(slot.roomType),
          roomsBlocked: Number(slot.roomsBlocked ?? 0),
          roomsPickedUp: 0,
          ratePlanCode: slot.ratePlanCode ? String(slot.ratePlanCode) : undefined,
          amount: RATES[String(slot.roomType)],
        })),
      ),
    };

    blocks.set(created.blockId, created);
    return created as T;
  }

  const blockMatch = /\/blk\/v1\/hotels\/[^/]+\/blocks\/([^/]+)$/.exec(path);
  if (blockMatch) {
    const blockId = decodeURIComponent(blockMatch[1] ?? '');
    const existing = blocks.get(blockId);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `블록을 찾을 수 없습니다: ${blockId}`);
    }

    if (method === 'GET') return existing as T;

    if (method === 'PATCH' || method === 'PUT') {
      const nextStatus = body.blockStatus ? String(body.blockStatus) : existing.blockStatus;

      // 이미 예약이 빠져나간 블록을 취소하면 그 예약들의 근거가 사라진다.
      const pickedUp = existing.roomTypeAllocations.reduce((sum, a) => sum + a.roomsPickedUp, 0);
      if (nextStatus === 'Cancelled' && pickedUp > 0) {
        throw new OperaApiError(
          400,
          { detail: 'BLOCK_HAS_PICKUP' },
          '이미 픽업된 예약이 있는 블록은 취소할 수 없습니다.',
        );
      }

      const updated: MockBlock = {
        ...existing,
        blockStatus: nextStatus,
        ...(body.blockName ? { blockName: String(body.blockName) } : {}),
        ...(body.cutoffDate ? { cutoffDate: String(body.cutoffDate) } : {}),
      };
      blocks.set(blockId, updated);
      return updated as T;
    }
  }

  // --- 예약 목록 ---------------------------------------------------------
  if (method === 'GET' && /\/reservations$/.test(path)) {
    let items = [...store.values()].filter((r) => r.hotelId === hotelId);

    if (query.blockCode) {
      items = items.filter((r) => r.roomStay.blockCode === String(query.blockCode));
    }
    if (query.sourceCode) {
      items = items.filter((r) => r.sourceOfBusiness.sourceCode === String(query.sourceCode));
    }
    if (query.channelCode) {
      items = items.filter((r) => r.sourceOfBusiness.channelCode === String(query.channelCode));
    }

    if (query.reservationStatus) {
      items = items.filter((r) => r.reservationStatus === query.reservationStatus);
    }
    if (query.arrivalStartDate) {
      items = items.filter((r) => r.roomStay.arrivalDate >= String(query.arrivalStartDate));
    }
    if (query.departureEndDate) {
      items = items.filter((r) => r.roomStay.departureDate <= String(query.departureEndDate));
    }

    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 50);

    return {
      reservations: items.slice(offset, offset + limit),
      totalResults: items.length,
    } as T;
  }

  // --- 예약 생성 ---------------------------------------------------------
  if (method === 'POST' && /\/reservations$/.test(path)) {
    const roomStay = (body.roomStay ?? {}) as Record<string, unknown>;
    const guest = (body.guest ?? {}) as Record<string, unknown>;

    const arrival = String(roomStay.arrivalDate ?? dayOffset(1));
    const departure = String(roomStay.departureDate ?? dayOffset(2));
    const roomType = String(roomStay.roomType ?? 'STDT');

    if (!(roomType in RATES)) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_ROOM_TYPE' },
        `알 수 없는 객실 타입: ${roomType}`,
      );
    }
    if (departure <= arrival) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_DATES' },
        '출발일은 도착일보다 뒤여야 합니다.',
      );
    }

    const blockCode = roomStay.blockCode ? String(roomStay.blockCode) : undefined;
    let block: MockBlock | undefined;
    if (blockCode) {
      block = [...blocks.values()].find((b) => b.hotelId === hotelId && b.blockCode === blockCode);
      if (!block) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_BLOCK' },
          `알 수 없는 블록 코드입니다: ${blockCode}`,
        );
      }
      if (block.blockStatus === 'Cancelled') {
        throw new OperaApiError(
          400,
          { detail: 'BLOCK_CANCELLED' },
          '취소된 블록으로는 예약할 수 없습니다.',
        );
      }
      assertPickupPossible(block, roomType, arrival, departure);
    }

    const business = (body.sourceOfBusiness ?? {}) as Record<string, unknown>;
    const sourceCode = String(business.sourceCode ?? 'DIRECT').toUpperCase();
    const marketCode = String(business.marketCode ?? 'TRANSIENT').toUpperCase();
    const channelCode = business.channelCode
      ? String(business.channelCode).toUpperCase()
      : undefined;

    assertCode(SOURCE_CODES, sourceCode, '예약 출처');
    assertCode(MARKET_CODES, marketCode, '시장 구분');
    if (channelCode) assertCode(CHANNEL_CODES, channelCode, '판매 채널');

    /*
     * 넘어온 프로필 ID 는 그대로 존중한다.
     *
     * 모의 저장소는 프로세스 수명만큼만 살아 있어 재시작 뒤에는 예전에 발급한
     * 프로필을 모른다. 그때 새 번호를 지어내면 호출자가 지정한 것과 다른 프로필에
     * 예약이 붙고, 재방문 손님마다 프로필이 하나씩 늘어난다.
     */
    const requestedProfileId = guest.profileId ? String(guest.profileId) : undefined;
    const existingProfile = requestedProfileId ? profiles.get(requestedProfileId) : undefined;
    if (existingProfile?.mergedIntoId) {
      throw new OperaApiError(
        400,
        { detail: 'PROFILE_MERGED' },
        `병합된 프로필로는 예약할 수 없습니다: ${existingProfile.profileId}`,
      );
    }

    sequence += 1;
    const created: MockReservation = {
      reservationId: `OPERA-${sequence}`,
      confirmationNumber: `OP${sequence}`,
      hotelId,
      reservationStatus: 'Reserved',
      roomStay: {
        arrivalDate: arrival,
        departureDate: departure,
        roomType,
        ratePlanCode: String(roomStay.ratePlanCode ?? 'BAR'),
        adultCount: Number(roomStay.adultCount ?? 1),
        childCount: Number(roomStay.childCount ?? 0),
        total: {
          amount: (RATES[roomType] ?? 0) * nights(arrival, departure),
          currencyCode: 'KRW',
        },
        ...(blockCode ? { blockCode } : {}),
      },
      /*
       * 기존 프로필로 예약하면 그 프로필의 이름을 쓴다.
       *
       * 보낸 이름으로 덮어쓰면 예약 한 건 때문에 손님 이름이 바뀐다. 프로필이
       * 사람의 기록 원천이고, 예약은 거기에 붙는 것이지 그 반대가 아니다.
       */
      guest: existingProfile
        ? {
            profileId: existingProfile.profileId,
            givenName: existingProfile.givenName ?? '',
            surname: existingProfile.surname ?? '',
            email: existingProfile.email,
          }
        : {
            profileId: requestedProfileId ?? `PRF-${sequence}`,
            givenName: String(guest.givenName ?? ''),
            surname: String(guest.surname ?? ''),
            email: guest.email ? String(guest.email) : undefined,
          },
      sourceOfBusiness: {
        sourceCode,
        marketCode,
        ...(channelCode ? { channelCode } : {}),
      },
    };

    store.set(created.reservationId, created);
    rememberProfile(created.guest);
    if (block) applyPickup(block, roomType, arrival, departure);
    return created as T;
  }

  // --- 예약 단건 / 수정 / 취소 -------------------------------------------
  const match = /\/reservations\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1] ?? '');
    const existing = store.get(id);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    if (method === 'GET') return existing as T;

    if (method === 'PUT' || method === 'PATCH') {
      const nextStatus = body.reservationStatus ? String(body.reservationStatus) : undefined;
      if (nextStatus === 'NoShow') {
        assertNoShowAllowed(existing, businessDates.get(hotelId) ?? dayOffset(0));
      }

      const roomStay = (body.roomStay ?? {}) as Record<string, unknown>;
      const updated: MockReservation = {
        ...existing,
        ...(nextStatus ? { reservationStatus: nextStatus } : {}),
        roomStay: {
          ...existing.roomStay,
          ...(roomStay.arrivalDate ? { arrivalDate: String(roomStay.arrivalDate) } : {}),
          ...(roomStay.departureDate ? { departureDate: String(roomStay.departureDate) } : {}),
          ...(roomStay.roomType ? { roomType: String(roomStay.roomType) } : {}),
          ...(roomStay.ratePlanCode ? { ratePlanCode: String(roomStay.ratePlanCode) } : {}),
          ...(roomStay.adultCount === undefined ? {} : { adultCount: Number(roomStay.adultCount) }),
          ...(roomStay.childCount === undefined ? {} : { childCount: Number(roomStay.childCount) }),
        },
      };
      updated.roomStay.total = {
        amount:
          (RATES[updated.roomStay.roomType] ?? 0) *
          nights(updated.roomStay.arrivalDate, updated.roomStay.departureDate),
        currencyCode: 'KRW',
      };
      store.set(id, updated);
      return updated as T;
    }

    if (method === 'DELETE') {
      const cancelled: MockReservation = { ...existing, reservationStatus: 'Cancelled' };
      store.set(id, cancelled);
      return cancelled as T;
    }
  }

  throw new OperaApiError(
    501,
    { detail: 'NOT_IMPLEMENTED_IN_MOCK' },
    `모의 모드가 아직 다루지 않는 경로입니다: ${method} ${path}`,
  );
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 테스트가 상태를 초기화할 때 쓴다. */
export function resetMockStore(): void {
  store.clear();
  rooms.clear();
  blocks.clear();
  businessDates.clear();
  profiles.clear();
  sequence = SEQUENCE_START;
  blockSequence = BLOCK_SEQUENCE_START;
}
