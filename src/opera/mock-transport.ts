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
  };
  guest: { profileId: string; givenName: string; surname: string; email?: string };
}

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
    },
  ];

  for (const reservation of base) {
    store.set(reservation.reservationId, reservation);
  }
}

function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

export function mockOperaRequest<T>(path: string, options: OperaRequestOptions): T {
  seed();

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

  // --- 예약 목록 ---------------------------------------------------------
  if (method === 'GET' && /\/reservations$/.test(path)) {
    let items = [...store.values()].filter((r) => r.hotelId === hotelId);

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
      },
      guest: {
        profileId: String(guest.profileId ?? `PRF-${sequence}`),
        givenName: String(guest.givenName ?? ''),
        surname: String(guest.surname ?? ''),
        email: guest.email ? String(guest.email) : undefined,
      },
    };

    store.set(created.reservationId, created);
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
      const roomStay = (body.roomStay ?? {}) as Record<string, unknown>;
      const updated: MockReservation = {
        ...existing,
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
  sequence = SEQUENCE_START;
}
