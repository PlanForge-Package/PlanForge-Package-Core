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
    /**
     * 객실을 함께 쓰는 예약들의 묶음.
     *
     * 두 손님이 한 방을 쓰되 계산은 따로 하는 편성이다. 예약은 둘이지만
     * 객실은 하나이므로 재고도 하나만 차지한다.
     */
    shareGroupId?: string;
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

// --- 요금 엔진 -------------------------------------------------------------

/**
 * 기간과 요일에 따라 기준 요금을 덮어쓴다.
 *
 * 성수기·주말은 같은 객실이라도 값이 다르다. 총액만 주고받으면 어느 날이 왜
 * 비싼지 설명할 수 없어, 하루 단위로 계산해 내려준다.
 */
interface MockRateSeason {
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string;
  /** 0=일요일. 비우면 기간 내 매일. */
  daysOfWeek?: number[];
  amounts: Record<string, number>;
}

interface MockRatePlan {
  ratePlanCode: string;
  hotelId: string;
  name: string;
  description?: string;
  currencyCode: string;
  marketCode: string;
  /** 판매 기간. 이 밖의 날짜는 이 요금으로 팔지 않는다. */
  sellStartDate: string;
  sellEndDate: string;
  /** 객실 타입별 기준 요금. 여기 없는 객실 타입은 이 요금으로 팔지 않는다. */
  baseAmounts: Record<string, number>;
  seasons: MockRateSeason[];
  packageCodes: string[];
  status: string;
}

/**
 * 요금에 딸려 붙는 부가 상품.
 *
 * `includedInRate` 면 요금 안에 이미 들어 있어 총액이 늘지 않는다 — 조식 포함
 * 요금이 그렇다. 아니면 총액에 더한다. 이 구분을 놓치면 조식값을 두 번 받는다.
 */
interface MockPackage {
  packageCode: string;
  hotelId: string;
  name: string;
  amount: number;
  /** PerNight = 1박당, PerStay = 투숙당 1회, PerPerson = 1인 1박당. */
  calculation: string;
  transactionCode: string;
  includedInRate: boolean;
}

const ratePlans = new Map<string, MockRatePlan>();
const packages = new Map<string, MockPackage>();
let seasonSequence = 0;

/**
 * 거래 코드.
 *
 * 회계 분개의 기준이다. 어떤 매출 그룹으로 잡히고 세금이 어떻게 붙는지가 여기
 * 달려 있어, 설정 없는 코드로 올라간 금액은 마감에서 어디로 보낼지 알 수 없다.
 *
 * 국내 호텔은 표시가격에 부가세·봉사료를 포함해 판다. 그래서 금액은 그대로 두고
 * 마감에서 공급가액·부가세·봉사료로 나눈다 — 세금을 따로 더하면 손님에게 안내한
 * 금액과 청구가 달라진다.
 */
interface MockTransactionCode {
  transactionCode: string;
  hotelId: string;
  name: string;
  /** Room = 객실, FoodBeverage = 식음, Other = 기타, Payment = 결제. */
  group: string;
  /** 부가세율. 0.1 이면 10%. */
  vatRate: number;
  /** 봉사료율. 식음은 보통 10%, 객실은 0 이다. */
  serviceChargeRate: number;
  /** 표시가격에 세금이 포함되어 있으면 true. */
  taxInclusive: boolean;
  active: boolean;
}

const transactionCodes = new Map<string, MockTransactionCode>();

function planKey(hotelId: string, code: string): string {
  return `${hotelId}::${code.toUpperCase()}`;
}

function seedTransactionCodes(): void {
  if (transactionCodes.size > 0) return;
  const hotelId = 'SAND01';

  const seeds: Array<Omit<MockTransactionCode, 'hotelId' | 'active'>> = [
    {
      transactionCode: '1000',
      name: '객실료',
      group: 'Room',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '1100',
      name: '엑스트라 베드',
      group: 'Room',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '2000',
      name: '조식',
      group: 'FoodBeverage',
      vatRate: 0.1,
      serviceChargeRate: 0.1,
      taxInclusive: true,
    },
    {
      transactionCode: '2100',
      name: '주차',
      group: 'Other',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '2200',
      name: '레이트 체크아웃',
      group: 'Other',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '3000',
      name: '레스토랑',
      group: 'FoodBeverage',
      vatRate: 0.1,
      serviceChargeRate: 0.1,
      taxInclusive: true,
    },
    {
      transactionCode: '3100',
      name: '미니바',
      group: 'FoodBeverage',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '4000',
      name: '세탁',
      group: 'Other',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '5000',
      name: '결제',
      group: 'Payment',
      vatRate: 0,
      serviceChargeRate: 0,
      taxInclusive: false,
    },
    {
      transactionCode: '6000',
      name: '거래처 이관',
      group: 'Payment',
      vatRate: 0,
      serviceChargeRate: 0,
      taxInclusive: false,
    },
    {
      transactionCode: '7000',
      name: '조정',
      group: 'Other',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
    {
      transactionCode: '9000',
      name: '기타',
      group: 'Other',
      vatRate: 0.1,
      serviceChargeRate: 0,
      taxInclusive: true,
    },
  ];

  for (const seed of seeds) {
    transactionCodes.set(planKey(hotelId, seed.transactionCode), {
      ...seed,
      hotelId,
      active: true,
    });
  }
}

function seedRates(): void {
  if (ratePlans.size > 0) return;
  const hotelId = 'SAND01';

  for (const pkg of [
    {
      packageCode: 'BFAST',
      name: '조식',
      amount: 25000,
      calculation: 'PerPerson',
      transactionCode: '2000',
      includedInRate: false,
    },
    {
      packageCode: 'PARK',
      name: '주차',
      amount: 15000,
      calculation: 'PerNight',
      transactionCode: '2100',
      includedInRate: false,
    },
    {
      packageCode: 'LATE',
      name: '레이트 체크아웃',
      amount: 50000,
      calculation: 'PerStay',
      transactionCode: '2200',
      includedInRate: false,
    },
  ]) {
    packages.set(planKey(hotelId, pkg.packageCode), { hotelId, ...pkg });
  }

  const year = new Date().getUTCFullYear();
  const plans: MockRatePlan[] = [
    {
      ratePlanCode: 'BAR',
      hotelId,
      name: '기준 요금',
      description: '판매 가능한 최선 요금',
      currencyCode: 'KRW',
      marketCode: 'TRANSIENT',
      sellStartDate: `${year - 1}-01-01`,
      sellEndDate: `${year + 2}-12-31`,
      baseAmounts: { ...RATES },
      seasons: [
        {
          seasonId: 'SEA-1',
          name: '성수기 주중',
          startDate: `${year}-07-15`,
          endDate: `${year}-08-20`,
          daysOfWeek: [0, 1, 2, 3, 4],
          amounts: { STDT: 250000, DLXK: 320000, SUIT: 520000 },
        },
        {
          seasonId: 'SEA-2',
          name: '성수기 주말',
          startDate: `${year}-07-15`,
          endDate: `${year}-08-20`,
          daysOfWeek: [5, 6],
          amounts: { STDT: 280000, DLXK: 360000, SUIT: 580000 },
        },
        {
          seasonId: 'SEA-3',
          name: '주말',
          startDate: `${year - 1}-01-01`,
          endDate: `${year}-07-14`,
          daysOfWeek: [5, 6],
          amounts: { STDT: 220000, DLXK: 280000, SUIT: 460000 },
        },
        {
          seasonId: 'SEA-4',
          name: '주말',
          startDate: `${year}-08-21`,
          endDate: `${year + 2}-12-31`,
          daysOfWeek: [5, 6],
          amounts: { STDT: 220000, DLXK: 280000, SUIT: 460000 },
        },
      ],
      packageCodes: [],
      status: 'Active',
    },
    {
      ratePlanCode: 'CORP',
      hotelId,
      name: '법인 협약',
      description: '계약 법인 전용',
      currencyCode: 'KRW',
      marketCode: 'CORPORATE',
      sellStartDate: `${year - 1}-01-01`,
      sellEndDate: `${year + 2}-12-31`,
      baseAmounts: { STDT: 160000, DLXK: 200000, SUIT: 340000 },
      seasons: [],
      packageCodes: ['BFAST'],
      status: 'Active',
    },
  ];

  for (const plan of plans) {
    ratePlans.set(planKey(plan.hotelId, plan.ratePlanCode), plan);
  }
  seasonSequence = 4;
}

/**
 * 같은 날 같은 객실에 두 시즌이 걸리지 않게 한다.
 *
 * 겹치도록 두면 무엇이 이기는지가 등록 순서에 달리고, 성수기 금요일이 평일보다
 * 싸지는 일이 생긴다. 성수기 주중·주말처럼 요일을 갈라 따로 등록해야 한다.
 */
function assertNoSeasonConflict(plan: MockRatePlan, candidate: MockRateSeason): void {
  const days = candidate.daysOfWeek?.length ? candidate.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const roomTypes = Object.keys(candidate.amounts);

  for (const season of plan.seasons) {
    if (candidate.startDate > season.endDate || candidate.endDate < season.startDate) continue;

    const seasonDays = season.daysOfWeek?.length ? season.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    if (!days.some((day) => seasonDays.includes(day))) continue;

    const clashing = roomTypes.filter((roomType) => season.amounts[roomType] !== undefined);
    if (clashing.length === 0) continue;

    throw new OperaApiError(
      409,
      { detail: 'SEASON_OVERLAP' },
      `기간이 겹치는 시즌이 이미 있습니다: ${season.name} (${season.startDate} ~ ${season.endDate}, ${clashing.join(', ')}). 요일을 나누거나 기간을 조정해 주세요.`,
    );
  }
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * 그날 그 객실의 단가.
 *
 * 시즌은 뒤에 등록한 것이 이긴다 — 넓은 기간 위에 좁은 기간을 덮어쓰는 것이
 * 요금 설정의 보통 순서다.
 */
function nightlyAmount(plan: MockRatePlan, roomType: string, date: string): number {
  let amount = plan.baseAmounts[roomType] ?? 0;
  for (const season of plan.seasons) {
    if (date < season.startDate || date > season.endDate) continue;
    if (season.daysOfWeek?.length && !season.daysOfWeek.includes(dayOfWeek(date))) continue;
    if (season.amounts[roomType] === undefined) continue;
    amount = season.amounts[roomType];
  }
  return amount;
}

interface Quote {
  ratePlanCode: string;
  ratePlanName: string;
  roomType: string;
  currencyCode: string;
  nightlyRates: Array<{ date: string; amount: number; packageAmount: number }>;
  roomTotal: number;
  packageTotal: number;
  totalAmount: number;
  packages: Array<{
    packageCode: string;
    name: string;
    amount: number;
    calculation: string;
    includedInRate: boolean;
  }>;
}

/** 요금 계산. 안내와 청구가 같은 값을 쓰도록 한 곳에서만 계산한다. */
function quote(
  plan: MockRatePlan,
  roomType: string,
  arrival: string,
  departure: string,
  adults: number,
): Quote | undefined {
  if (plan.baseAmounts[roomType] === undefined) return undefined;

  const dates = stayDates(arrival, departure);
  const attached = plan.packageCodes
    .map((code) => packages.get(planKey(plan.hotelId, code)))
    .filter((pkg): pkg is MockPackage => Boolean(pkg));

  const perNight = attached
    .filter((pkg) => !pkg.includedInRate)
    .reduce((sum, pkg) => {
      if (pkg.calculation === 'PerNight') return sum + pkg.amount;
      if (pkg.calculation === 'PerPerson') return sum + pkg.amount * Math.max(1, adults);
      return sum;
    }, 0);
  const perStay = attached
    .filter((pkg) => !pkg.includedInRate && pkg.calculation === 'PerStay')
    .reduce((sum, pkg) => sum + pkg.amount, 0);

  const nightlyRates = dates.map((date, index) => ({
    date,
    amount: nightlyAmount(plan, roomType, date),
    // 투숙당 1회인 패키지는 첫날에 붙인다. 매일 붙이면 박수만큼 더 받는다.
    packageAmount: perNight + (index === 0 ? perStay : 0),
  }));

  const roomTotal = nightlyRates.reduce((sum, night) => sum + night.amount, 0);
  const packageTotal = nightlyRates.reduce((sum, night) => sum + night.packageAmount, 0);

  return {
    ratePlanCode: plan.ratePlanCode,
    ratePlanName: plan.name,
    roomType,
    currencyCode: plan.currencyCode,
    nightlyRates,
    roomTotal,
    packageTotal,
    totalAmount: roomTotal + packageTotal,
    packages: attached.map((pkg) => ({
      packageCode: pkg.packageCode,
      name: pkg.name,
      amount: pkg.amount,
      calculation: pkg.calculation,
      includedInRate: pkg.includedInRate,
    })),
  };
}

/**
 * 블록의 그날 그 객실 값.
 *
 * 협의 요금을 넣었으면 그것이 이긴다 — 단체는 값을 따로 합의하고, 그 합의가
 * 정가보다 우선한다. 넣지 않았으면 지정한 요금 코드의 계산을 따르고, 그것도
 * 없으면 기준 요금이다.
 */
function blockAmount(
  hotelId: string,
  slot: Record<string, unknown>,
  roomType: string,
  date: string,
): number {
  if (slot.amount !== undefined) return Number(slot.amount);

  const code = slot.ratePlanCode ? String(slot.ratePlanCode) : 'BAR';
  const plan = ratePlans.get(planKey(hotelId, code));
  if (!plan || plan.baseAmounts[roomType] === undefined) return RATES[roomType] ?? 0;

  return nightlyAmount(plan, roomType, date);
}

/** 그 기간에 팔 수 있는 요금만 고른다. */
function sellablePlans(hotelId: string, arrival: string, departure: string): MockRatePlan[] {
  const lastNight = addDays(departure, -1);
  return [...ratePlans.values()].filter(
    (plan) =>
      plan.hotelId === hotelId &&
      plan.status === 'Active' &&
      plan.sellStartDate <= arrival &&
      plan.sellEndDate >= lastNight,
  );
}

/**
 * 예약에 적용할 요금을 찾는다.
 *
 * 없는 요금 코드로 예약을 받으면 금액이 0 인 예약이 생기고, 그 사실은 손님이
 * 나갈 때에야 드러난다.
 */
function requirePlan(hotelId: string, code: string): MockRatePlan {
  const plan = ratePlans.get(planKey(hotelId, code));
  if (!plan) {
    throw new OperaApiError(400, { detail: 'INVALID_RATE_PLAN' }, `알 수 없는 요금 코드: ${code}`);
  }
  return plan;
}

/** 모의 객실 상태. 실제로는 OPERA 가 들고 있다. */
const rooms = new Map<string, { roomStatus: string; occupied: boolean; roomType: string }>();

interface MockRoomOutage {
  outageId: string;
  hotelId: string;
  roomId: string;
  /** OutOfOrder = 재고에서 제외, OutOfService = 판매만 중지. */
  kind: string;
  startDate: string;
  endDate: string;
  reason: string;
  returnStatus: string;
}

/** 사용 불가 객실 기간. 예약 재고를 깎는 쪽이라 예약과 같은 수명으로 둔다. */
const roomOutages = new Map<string, MockRoomOutage>();

interface MockPosting {
  postingId: string;
  type: string;
  transactionCode: string;
  description: string;
  /** 부호가 붙은 값. 청구는 양수, 결제는 음수다. */
  amount: number;
  currencyCode: string;
  postedAt: string;
  reference?: string;
  voidedById?: string;
  transferredFromWindow?: number;
}

interface MockFolio {
  folioId: string;
  reservationId: string;
  hotelId: string;
  window: number;
  status: string;
  currencyCode: string;
  postings: MockPosting[];
}

/**
 * 모의 폴리오 원장.
 *
 * 잔액은 저장하지 않는다. 거래 합계로 매번 다시 센다 — 증분으로 더해 가면 한
 * 번의 실패가 영구적인 잔액 오차로 남는다.
 */
const folios = new Map<string, MockFolio>();

const FOLIO_SEQUENCE_START = 800;
let folioSequence = FOLIO_SEQUENCE_START;
let postingSequence = FOLIO_SEQUENCE_START;

const OUTAGE_SEQUENCE_START = 700;
let outageSequence = OUTAGE_SEQUENCE_START;

/** 객실 공유 묶음 번호. */
const SHARE_SEQUENCE_START = 900;
let shareSequence = SHARE_SEQUENCE_START;

/** 공유 표시만 떼어 낸 roomStay. 나머지는 그대로 둔다. */
function dropShare(roomStay: MockReservation['roomStay']): MockReservation['roomStay'] {
  const copy = { ...roomStay };
  delete copy.shareGroupId;
  return copy;
}

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
  // 객실 번호 · 하우스키핑 상태 · 재실 여부 · 객실 타입. BE 시드와 같은 편성이다.
  const base: Array<[string, string, boolean, string]> = [
    ['1101', 'Clean', false, 'STDT'],
    ['1102', 'Dirty', false, 'STDT'],
    ['1103', 'Inspected', false, 'DLXK'],
    ['1201', 'Clean', false, 'DLXK'],
    ['1202', 'Clean', false, 'DLXK'],
    ['1203', 'Inspected', true, 'DLXK'],
    ['1501', 'Clean', false, 'SUIT'],
    ['1502', 'OutOfOrder', false, 'SUIT'],
  ];
  for (const [roomId, roomStatus, occupied, roomType] of base) {
    rooms.set(roomId, { roomStatus, occupied, roomType });
  }
}

function seedOutages(): void {
  if (roomOutages.size > 0) return;
  // 시드 객실 1502 가 OutOfOrder 인 이유를 기간으로 남겨 둔다. 상태만 있고
  // 근거가 없으면 언제 되파는지 아무도 모른다.
  const outageId = `OOO-${(outageSequence += 1)}`;
  roomOutages.set(outageId, {
    outageId,
    hotelId: 'SAND01',
    roomId: '1502',
    kind: 'OutOfOrder',
    startDate: dayOffset(-3),
    endDate: dayOffset(14),
    reason: '욕실 배관 교체 공사',
    returnStatus: 'Dirty',
  });
}

/** 사용 불가 기간이 투숙 기간(도착 ~ 출발 전날)에 하루라도 걸치는가. */
function outageOverlapsStay(outage: MockRoomOutage, arrival: string, departure: string): boolean {
  const lastNight = addDays(departure, -1);
  return outage.startDate <= lastNight && outage.endDate >= arrival;
}

/** 해당 날짜에 사용 불가인가. 시작·종료일 모두 포함이다. */
function outageCoversDate(outage: MockRoomOutage, date: string): boolean {
  return outage.startDate <= date && outage.endDate >= date;
}

/** 잔액은 언제나 거래 합계다. 소수점 둘째 자리에서 끊는다. */
function folioBalance(folio: MockFolio): number {
  const total = folio.postings.reduce((sum, posting) => sum + posting.amount, 0);
  return Math.round(total * 100) / 100;
}

function toFolioPayload(folio: MockFolio) {
  return { ...folio, balance: folioBalance(folio) };
}

function reservationFolios(reservationId: string): MockFolio[] {
  return [...folios.values()]
    .filter((folio) => folio.reservationId === reservationId)
    .sort((a, b) => a.window - b.window);
}

/**
 * 예약의 폴리오를 찾고, 없으면 1번 창구를 연다.
 *
 * OPERA 는 예약을 만들 때 폴리오를 함께 만든다. 시드 예약까지 일일이 만들어
 * 두는 대신 처음 필요해질 때 연다 — 밖에서 보이는 결과는 같다.
 */
function ensureFolio(hotelId: string, reservationId: string, window: number): MockFolio {
  const existing = reservationFolios(reservationId).find((folio) => folio.window === window);
  if (existing) return existing;

  if (window !== 1) {
    throw new OperaApiError(
      404,
      { detail: 'FOLIO_NOT_FOUND' },
      `윈도 ${window} 이 열려 있지 않습니다.`,
    );
  }

  const folioId = `FOL-${(folioSequence += 1)}`;
  const folio: MockFolio = {
    folioId,
    reservationId,
    hotelId,
    window: 1,
    status: 'Open',
    currencyCode: 'KRW',
    postings: [],
  };
  folios.set(folioId, folio);
  return folio;
}

/** 객실 타입별 재고. 실제로는 호텔 설정에서 온다. */
const INVENTORY: Record<string, number> = { STDT: 10, DLXK: 10, SUIT: 4 };

/**
 * 그 기간에 팔 수 있는 객실 수.
 *
 * 재고 안내와 예약 수락이 같은 계산을 써야 한다. 따로 두면 화면에 "매진" 이라고
 * 떠 있는데 예약은 만들어지는 일이 생긴다.
 *
 * 대기 예약은 세지 않는다 — 자리를 차지하지 않고 기다리는 것이 대기다.
 */
function availableRooms(
  hotelId: string,
  roomType: string,
  arrival: string,
  departure: string,
): number {
  /*
   * 객실을 공유하는 예약은 하나로 센다.
   *
   * 예약은 둘이어도 객실은 하나다. 각각 세면 재고가 실제보다 빨리 소진되어
   * 팔 수 있는 방을 팔지 못한다.
   */
  const occupying = [...store.values()].filter(
    (r) =>
      r.hotelId === hotelId &&
      r.roomStay.roomType === roomType &&
      !['Cancelled', 'NoShow', 'Waitlisted'].includes(r.reservationStatus) &&
      r.roomStay.arrivalDate < departure &&
      r.roomStay.departureDate > arrival,
  );
  const sold = new Set(occupying.map((r) => r.roomStay.shareGroupId ?? r.reservationId)).size;

  const blocked = [...roomOutages.values()].filter(
    (outage) =>
      outage.hotelId === hotelId &&
      rooms.get(outage.roomId)?.roomType === roomType &&
      outageOverlapsStay(outage, arrival, departure),
  ).length;

  return Math.max(0, (INVENTORY[roomType] ?? 0) - sold - blocked);
}

/** 거래 종류가 잔액 방향을 정한다. */
function signedAmount(type: string, amount: number, negative?: boolean): number {
  switch (type) {
    case 'Charge':
    case 'Tax':
      return amount;
    case 'Payment':
      return -amount;
    case 'Adjustment':
      return negative ? -amount : amount;
    default:
      throw new OperaApiError(
        400,
        { detail: 'INVALID_POSTING_TYPE' },
        `알 수 없는 거래 종류입니다: ${type}`,
      );
  }
}

function findPosting(
  reservationId: string,
  postingId: string,
): { folio: MockFolio; posting: MockPosting } {
  for (const folio of reservationFolios(reservationId)) {
    const posting = folio.postings.find((row) => row.postingId === postingId);
    if (posting) return { folio, posting };
  }
  throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `거래를 찾을 수 없습니다: ${postingId}`);
}

/** 그 기간에 팔 수 있는 객실인지. 사용 불가 기간과 겹치면 배정할 수 없다. */
function assertRoomAssignable(
  hotelId: string,
  roomId: string,
  arrival: string,
  departure: string,
): void {
  if (!rooms.has(roomId)) {
    throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `객실을 찾을 수 없습니다: ${roomId}`);
  }

  const blocking = [...roomOutages.values()].find(
    (outage) =>
      outage.hotelId === hotelId &&
      outage.roomId === roomId &&
      outageOverlapsStay(outage, arrival, departure),
  );
  if (blocking) {
    throw new OperaApiError(
      409,
      { detail: 'ROOM_UNAVAILABLE' },
      `객실 ${roomId} 는 ${blocking.startDate} ~ ${blocking.endDate} 기간에 사용 불가입니다: ${blocking.reason}`,
    );
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

/** 체크인할 수 있는 출발 상태. 취소·노쇼된 예약으로 방을 내줄 수는 없다. */
const CHECK_IN_FROM = ['Reserved', 'Confirmed'];

/** OPERA 는 예약당 폴리오 윈도를 8개까지 둔다. */
const MAX_FOLIO_WINDOW = 8;

function assertReservationExists(reservationId: string): void {
  if (!store.has(reservationId)) {
    throw new OperaApiError(
      404,
      { detail: 'NOT_FOUND' },
      `예약을 찾을 수 없습니다: ${reservationId}`,
    );
  }
}

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
  seedOutages();
  seedBlocks();
  seedRates();
  seedTransactionCodes();

  const method = options.method ?? 'GET';
  const query = options.query ?? {};
  const body = (options.body ?? {}) as Record<string, unknown>;
  const hotelId = options.hotelId ?? 'SAND01';

  // --- 가용 재고 ---------------------------------------------------------
  if (method === 'GET' && /\/availability$/.test(path)) {
    const arrival = String(query.startDate ?? dayOffset(0));
    const departure = String(query.endDate ?? dayOffset(1));
    const stayNights = nights(arrival, departure);

    // 안내와 수락이 같은 계산을 쓴다. 따로 두면 "매진" 인데 예약이 만들어진다.
    const roomTypes = query.roomType ? [String(query.roomType)] : Object.keys(RATES);
    const adults = Number(query.adults ?? 1);
    const sellable = sellablePlans(hotelId, arrival, departure);

    return {
      roomStays: roomTypes.map((code) => {
        // 안내 총액은 그 객실을 팔 수 있는 가장 싼 요금을 기준으로 한다.
        const cheapest = sellable
          .map((plan) => quote(plan, code, arrival, departure, adults))
          .filter((row): row is Quote => Boolean(row))
          .sort((a, b) => a.totalAmount - b.totalAmount)[0];

        return {
          roomType: code,
          roomTypeName: ROOM_TYPE_NAMES[code],
          available: availableRooms(hotelId, code, arrival, departure),
          ratePlanCode: cheapest?.ratePlanCode ?? 'BAR',
          total: {
            amount: cheapest?.totalAmount ?? (RATES[code] ?? 0) * stayNights,
            currencyCode: 'KRW',
          },
        };
      }),
    } as T;
  }

  // --- 요금 --------------------------------------------------------------
  if (method === 'GET' && /\/rates$/.test(path)) {
    const arrival = String(query.startDate ?? dayOffset(0));
    const departure = String(query.endDate ?? dayOffset(1));
    const adults = Number(query.adults ?? 1);
    const wantedRoomType = query.roomType ? String(query.roomType) : undefined;
    const wantedPlan = query.ratePlanCode ? String(query.ratePlanCode).toUpperCase() : undefined;

    const offers = sellablePlans(hotelId, arrival, departure)
      .filter((plan) => !wantedPlan || plan.ratePlanCode === wantedPlan)
      .flatMap((plan) =>
        (wantedRoomType ? [wantedRoomType] : Object.keys(plan.baseAmounts))
          .map((code) => quote(plan, code, arrival, departure, adults))
          .filter((row): row is Quote => Boolean(row))
          .map((row) => ({
            ratePlanCode: row.ratePlanCode,
            ratePlanName: row.ratePlanName,
            roomType: row.roomType,
            roomTypeName: ROOM_TYPE_NAMES[row.roomType],
            currencyCode: row.currencyCode,
            // 하루치 단가와 총액을 함께 준다. OPERA 도 기간 요금을 이렇게 내려준다.
            nightlyRates: row.nightlyRates,
            packages: row.packages,
            total: { amount: row.totalAmount, currencyCode: row.currencyCode },
          })),
      );

    return { ratePlans: offers } as T;
  }

  // --- 거래 코드 -----------------------------------------------------------
  if (/\/csh\/v1\/hotels\/[^/]+\/transactionCodes$/.test(path)) {
    if (method === 'GET') {
      return {
        transactionCodes: [...transactionCodes.values()].filter(
          (row) => row.hotelId === hotelId && (query.includeInactive === 'true' || row.active),
        ),
      } as T;
    }
    if (method === 'POST') {
      const code = String(body.transactionCode ?? '').trim();
      if (!code) {
        throw new OperaApiError(400, { detail: 'INVALID_CODE' }, '거래 코드가 필요합니다.');
      }
      if (transactionCodes.has(planKey(hotelId, code))) {
        throw new OperaApiError(
          409,
          { detail: 'DUPLICATE_CODE' },
          `이미 쓰고 있는 거래 코드입니다: ${code}`,
        );
      }
      const group = String(body.group ?? 'Other');
      assertCode(['Room', 'FoodBeverage', 'Other', 'Payment'], group, '매출 그룹');

      const created: MockTransactionCode = {
        transactionCode: code,
        hotelId,
        name: String(body.name ?? code),
        group,
        vatRate: Number(body.vatRate ?? 0.1),
        serviceChargeRate: Number(body.serviceChargeRate ?? 0),
        taxInclusive: body.taxInclusive === undefined ? true : Boolean(body.taxInclusive),
        active: true,
      };
      transactionCodes.set(planKey(hotelId, code), created);
      return created as T;
    }
  }

  const txnCodeMatch = /\/csh\/v1\/hotels\/[^/]+\/transactionCodes\/([^/]+)$/.exec(path);
  if (txnCodeMatch && (method === 'PATCH' || method === 'PUT')) {
    const code = decodeURIComponent(txnCodeMatch[1] ?? '');
    const existing = transactionCodes.get(planKey(hotelId, code));
    if (!existing) {
      throw new OperaApiError(
        404,
        { detail: 'NOT_FOUND' },
        `거래 코드를 찾을 수 없습니다: ${code}`,
      );
    }
    if (body.group !== undefined) {
      assertCode(['Room', 'FoodBeverage', 'Other', 'Payment'], String(body.group), '매출 그룹');
    }

    const updated: MockTransactionCode = {
      ...existing,
      ...(body.name === undefined ? {} : { name: String(body.name) }),
      ...(body.group === undefined ? {} : { group: String(body.group) }),
      ...(body.vatRate === undefined ? {} : { vatRate: Number(body.vatRate) }),
      ...(body.serviceChargeRate === undefined
        ? {}
        : { serviceChargeRate: Number(body.serviceChargeRate) }),
      ...(body.taxInclusive === undefined ? {} : { taxInclusive: Boolean(body.taxInclusive) }),
      ...(body.active === undefined ? {} : { active: Boolean(body.active) }),
    };
    transactionCodes.set(planKey(hotelId, code), updated);
    return updated as T;
  }

  // --- 요금 코드 관리 ------------------------------------------------------
  if (/\/rtp\/v1\/hotels\/[^/]+\/packages$/.test(path)) {
    if (method === 'GET') {
      return {
        packages: [...packages.values()].filter((pkg) => pkg.hotelId === hotelId),
      } as T;
    }
    if (method === 'POST') {
      const code = String(body.packageCode ?? '')
        .trim()
        .toUpperCase();
      if (!code) {
        throw new OperaApiError(400, { detail: 'INVALID_CODE' }, '패키지 코드가 필요합니다.');
      }
      if (packages.has(planKey(hotelId, code))) {
        throw new OperaApiError(
          409,
          { detail: 'DUPLICATE_CODE' },
          `이미 쓰고 있는 패키지 코드입니다: ${code}`,
        );
      }
      const calculation = String(body.calculation ?? 'PerNight');
      assertCode(['PerNight', 'PerStay', 'PerPerson'], calculation, '패키지 계산 방식');

      const created: MockPackage = {
        packageCode: code,
        hotelId,
        name: String(body.name ?? code),
        amount: Number(body.amount ?? 0),
        calculation,
        transactionCode: String(body.transactionCode ?? '2000'),
        includedInRate: Boolean(body.includedInRate),
      };
      packages.set(planKey(hotelId, code), created);
      return created as T;
    }
  }

  const packageMatch = /\/rtp\/v1\/hotels\/[^/]+\/packages\/([^/]+)$/.exec(path);
  if (packageMatch && (method === 'PATCH' || method === 'PUT')) {
    const code = decodeURIComponent(packageMatch[1] ?? '').toUpperCase();
    const existing = packages.get(planKey(hotelId, code));
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `패키지를 찾을 수 없습니다: ${code}`);
    }
    if (body.calculation !== undefined) {
      assertCode(
        ['PerNight', 'PerStay', 'PerPerson'],
        String(body.calculation),
        '패키지 계산 방식',
      );
    }
    const updated: MockPackage = {
      ...existing,
      ...(body.name === undefined ? {} : { name: String(body.name) }),
      ...(body.amount === undefined ? {} : { amount: Number(body.amount) }),
      ...(body.calculation === undefined ? {} : { calculation: String(body.calculation) }),
      ...(body.transactionCode === undefined
        ? {}
        : { transactionCode: String(body.transactionCode) }),
      ...(body.includedInRate === undefined
        ? {}
        : { includedInRate: Boolean(body.includedInRate) }),
    };
    packages.set(planKey(hotelId, code), updated);
    return updated as T;
  }

  if (/\/rtp\/v1\/hotels\/[^/]+\/ratePlans$/.test(path)) {
    if (method === 'GET') {
      const wanted = query.status ? String(query.status) : undefined;
      return {
        ratePlans: [...ratePlans.values()].filter(
          (plan) => plan.hotelId === hotelId && (!wanted || plan.status === wanted),
        ),
      } as T;
    }
    if (method === 'POST') {
      const code = String(body.ratePlanCode ?? '')
        .trim()
        .toUpperCase();
      if (!code) {
        throw new OperaApiError(400, { detail: 'INVALID_CODE' }, '요금 코드가 필요합니다.');
      }
      if (ratePlans.has(planKey(hotelId, code))) {
        throw new OperaApiError(
          409,
          { detail: 'DUPLICATE_CODE' },
          `이미 쓰고 있는 요금 코드입니다: ${code}`,
        );
      }

      const baseAmounts = (body.baseAmounts ?? {}) as Record<string, unknown>;
      const amounts: Record<string, number> = {};
      for (const [roomType, value] of Object.entries(baseAmounts)) {
        if (!(roomType in RATES)) {
          throw new OperaApiError(
            400,
            { detail: 'INVALID_ROOM_TYPE' },
            `알 수 없는 객실 타입: ${roomType}`,
          );
        }
        amounts[roomType] = Number(value);
      }
      if (Object.keys(amounts).length === 0) {
        throw new OperaApiError(
          400,
          { detail: 'NO_AMOUNTS' },
          '객실 타입별 기준 요금이 하나도 없습니다. 팔 수 없는 요금은 만들지 않습니다.',
        );
      }

      const sellStartDate = String(body.sellStartDate ?? dayOffset(0));
      const sellEndDate = String(body.sellEndDate ?? dayOffset(365));
      if (sellEndDate < sellStartDate) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_DATES' },
          '판매 종료일은 시작일보다 뒤여야 합니다.',
        );
      }

      for (const code of (body.packageCodes ?? []) as string[]) {
        if (!packages.has(planKey(hotelId, String(code).toUpperCase()))) {
          throw new OperaApiError(
            400,
            { detail: 'INVALID_PACKAGE' },
            `알 수 없는 패키지 코드: ${code}`,
          );
        }
      }

      const created: MockRatePlan = {
        ratePlanCode: code,
        hotelId,
        name: String(body.name ?? code),
        description: body.description ? String(body.description) : undefined,
        currencyCode: String(body.currencyCode ?? 'KRW'),
        marketCode: String(body.marketCode ?? 'TRANSIENT'),
        sellStartDate,
        sellEndDate,
        baseAmounts: amounts,
        seasons: [],
        packageCodes: ((body.packageCodes ?? []) as string[]).map((c) => String(c).toUpperCase()),
        status: String(body.status ?? 'Active'),
      };
      ratePlans.set(planKey(hotelId, code), created);
      return created as T;
    }
  }

  const seasonMatch = /\/rtp\/v1\/hotels\/[^/]+\/ratePlans\/([^/]+)\/seasons$/.exec(path);
  if (seasonMatch && method === 'POST') {
    const plan = requirePlan(hotelId, decodeURIComponent(seasonMatch[1] ?? ''));
    const startDate = String(body.startDate ?? dayOffset(0));
    const endDate = String(body.endDate ?? dayOffset(1));
    if (endDate < startDate) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_DATES' },
        '시즌 종료일은 시작일보다 뒤여야 합니다.',
      );
    }

    const amounts: Record<string, number> = {};
    for (const [roomType, value] of Object.entries(
      (body.amounts ?? {}) as Record<string, unknown>,
    )) {
      if (plan.baseAmounts[roomType] === undefined) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_ROOM_TYPE' },
          `이 요금이 팔지 않는 객실 타입입니다: ${roomType}`,
        );
      }
      amounts[roomType] = Number(value);
    }
    if (Object.keys(amounts).length === 0) {
      throw new OperaApiError(400, { detail: 'NO_AMOUNTS' }, '시즌 요금이 비어 있습니다.');
    }

    seasonSequence += 1;
    const season: MockRateSeason = {
      seasonId: `SEA-${seasonSequence}`,
      name: String(body.name ?? '시즌'),
      startDate,
      endDate,
      ...(Array.isArray(body.daysOfWeek) && body.daysOfWeek.length
        ? { daysOfWeek: (body.daysOfWeek as number[]).map(Number) }
        : {}),
      amounts,
    };
    assertNoSeasonConflict(plan, season);
    plan.seasons.push(season);
    return plan as T;
  }

  const seasonDeleteMatch = /\/rtp\/v1\/hotels\/[^/]+\/ratePlans\/([^/]+)\/seasons\/([^/]+)$/.exec(
    path,
  );
  if (seasonDeleteMatch && method === 'DELETE') {
    const plan = requirePlan(hotelId, decodeURIComponent(seasonDeleteMatch[1] ?? ''));
    const seasonId = decodeURIComponent(seasonDeleteMatch[2] ?? '');
    const index = plan.seasons.findIndex((season) => season.seasonId === seasonId);
    if (index < 0) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `시즌을 찾을 수 없습니다: ${seasonId}`);
    }
    plan.seasons.splice(index, 1);
    return plan as T;
  }

  const planMatch = /\/rtp\/v1\/hotels\/[^/]+\/ratePlans\/([^/]+)$/.exec(path);
  if (planMatch) {
    const plan = requirePlan(hotelId, decodeURIComponent(planMatch[1] ?? ''));
    if (method === 'GET') return plan as T;

    if (method === 'PATCH' || method === 'PUT') {
      if (body.baseAmounts !== undefined) {
        const amounts: Record<string, number> = {};
        for (const [roomType, value] of Object.entries(
          body.baseAmounts as Record<string, unknown>,
        )) {
          if (!(roomType in RATES)) {
            throw new OperaApiError(
              400,
              { detail: 'INVALID_ROOM_TYPE' },
              `알 수 없는 객실 타입: ${roomType}`,
            );
          }
          amounts[roomType] = Number(value);
        }
        if (Object.keys(amounts).length === 0) {
          throw new OperaApiError(
            400,
            { detail: 'NO_AMOUNTS' },
            '객실 타입별 기준 요금이 하나도 없습니다.',
          );
        }
        plan.baseAmounts = amounts;
      }

      if (body.packageCodes !== undefined) {
        const codes = (body.packageCodes as string[]).map((c) => String(c).toUpperCase());
        for (const code of codes) {
          if (!packages.has(planKey(hotelId, code))) {
            throw new OperaApiError(
              400,
              { detail: 'INVALID_PACKAGE' },
              `알 수 없는 패키지 코드: ${code}`,
            );
          }
        }
        plan.packageCodes = codes;
      }

      if (body.name !== undefined) plan.name = String(body.name);
      if (body.description !== undefined) plan.description = String(body.description);
      if (body.marketCode !== undefined) plan.marketCode = String(body.marketCode);
      if (body.status !== undefined) plan.status = String(body.status);
      if (body.sellStartDate !== undefined) plan.sellStartDate = String(body.sellStartDate);
      if (body.sellEndDate !== undefined) plan.sellEndDate = String(body.sellEndDate);
      if (plan.sellEndDate < plan.sellStartDate) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_DATES' },
          '판매 종료일은 시작일보다 뒤여야 합니다.',
        );
      }

      return plan as T;
    }
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

  // --- 사용 불가 객실 -----------------------------------------------------
  if (method === 'GET' && /\/hsk\/v1\/hotels\/[^/]+\/outOfOrders$/.test(path)) {
    const roomFilter = query.roomId ? String(query.roomId) : undefined;
    const onDate = query.onDate ? String(query.onDate) : undefined;

    return {
      outOfOrders: [...roomOutages.values()]
        .filter((outage) => outage.hotelId === hotelId)
        .filter((outage) => !roomFilter || outage.roomId === roomFilter)
        .filter((outage) => !onDate || outageCoversDate(outage, onDate))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.roomId.localeCompare(b.roomId))
        .map((outage) => ({ ...outage, roomType: rooms.get(outage.roomId)?.roomType })),
    } as T;
  }

  if (method === 'POST' && /\/hsk\/v1\/hotels\/[^/]+\/outOfOrders$/.test(path)) {
    const roomId = String(body.roomId ?? '');
    const room = rooms.get(roomId);
    if (!room) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `객실을 찾을 수 없습니다: ${roomId}`);
    }

    const kind = String(body.kind ?? '');
    if (kind !== 'OutOfOrder' && kind !== 'OutOfService') {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_KIND' },
        `알 수 없는 사용 불가 구분입니다: ${kind}. 가능한 값: OutOfOrder, OutOfService`,
      );
    }

    const startDate = String(body.startDate ?? '');
    const endDate = String(body.endDate ?? '');
    if (endDate < startDate) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_RANGE' },
        `종료일(${endDate})이 시작일(${startDate})보다 앞설 수 없습니다.`,
      );
    }

    // 이미 지난 기간을 막아도 그 사이 판 객실이 되돌아오지 않는다. 실적만 어긋난다.
    const today = businessDates.get(hotelId) ?? dayOffset(0);
    if (endDate < today) {
      throw new OperaApiError(
        400,
        { detail: 'PAST_PERIOD' },
        `이미 지난 기간(${startDate} ~ ${endDate})은 사용 불가로 등록할 수 없습니다.`,
      );
    }

    // 같은 객실을 두 번 빼면 재고에서 두 번 깎인다.
    const overlapping = [...roomOutages.values()].find(
      (outage) =>
        outage.hotelId === hotelId &&
        outage.roomId === roomId &&
        outage.startDate <= endDate &&
        outage.endDate >= startDate,
    );
    if (overlapping) {
      throw new OperaApiError(
        409,
        { detail: 'OVERLAPPING_OUTAGE' },
        `객실 ${roomId} 는 ${overlapping.startDate} ~ ${overlapping.endDate} 기간에 이미 사용 불가입니다.`,
      );
    }

    // 그 기간에 이 객실로 들어오기로 한 손님이 있으면 먼저 옮겨야 한다.
    // 등록만 받아 두면 도착 당일에야 알게 된다.
    const assigned = [...store.values()].find(
      (reservation) =>
        reservation.hotelId === hotelId &&
        reservation.roomStay.roomId === roomId &&
        !['Cancelled', 'NoShow', 'CheckedOut'].includes(reservation.reservationStatus) &&
        reservation.roomStay.arrivalDate <= endDate &&
        addDays(reservation.roomStay.departureDate, -1) >= startDate,
    );
    if (assigned) {
      throw new OperaApiError(
        409,
        { detail: 'ROOM_ASSIGNED' },
        `해당 기간에 예약 ${assigned.confirmationNumber} 가 객실 ${roomId} 에 배정되어 있습니다. 객실을 먼저 변경해 주세요.`,
      );
    }

    // 오늘 당장 빼는데 손님이 들어 있으면 막는다. 미래 기간은 그때까지 나가므로 허용한다.
    if (room.occupied && startDate <= today) {
      throw new OperaApiError(
        409,
        { detail: 'ROOM_OCCUPIED' },
        `객실 ${roomId} 는 재실 중이라 지금부터 사용 불가로 둘 수 없습니다.`,
      );
    }

    const outageId = `OOO-${(outageSequence += 1)}`;
    const outage: MockRoomOutage = {
      outageId,
      hotelId,
      roomId,
      kind,
      startDate,
      endDate,
      reason: String(body.reason ?? ''),
      returnStatus: String(body.returnStatus ?? 'Dirty'),
    };
    roomOutages.set(outageId, outage);

    // 기간이 오늘을 포함하면 하우스키핑 상태도 지금 바꾼다. 미래 건은 그대로 둔다 —
    // 다음 주 공사 때문에 오늘 못 파는 것은 아니다.
    if (outageCoversDate(outage, today)) {
      rooms.set(roomId, { ...room, roomStatus: kind });
    }

    return { ...outage, roomType: room.roomType } as T;
  }

  const outageMatch = /\/hsk\/v1\/hotels\/[^/]+\/outOfOrders\/([^/]+)$/.exec(path);
  if (outageMatch && method === 'DELETE') {
    const outageId = decodeURIComponent(outageMatch[1] ?? '');
    const outage = roomOutages.get(outageId);
    if (!outage || outage.hotelId !== hotelId) {
      throw new OperaApiError(
        404,
        { detail: 'NOT_FOUND' },
        `사용 불가 기록을 찾을 수 없습니다: ${outageId}`,
      );
    }

    roomOutages.delete(outageId);

    // 해제하면 객실을 되판다. 다만 청소 여부는 알 수 없으므로 복귀 상태는
    // 등록할 때 정해 둔 값(대개 Dirty)을 쓴다. Clean 으로 되돌리면 청소하지 않은
    // 객실이 판매 가능으로 보인다.
    const room = rooms.get(outage.roomId);
    const today = businessDates.get(hotelId) ?? dayOffset(0);
    if (room && outageCoversDate(outage, today)) {
      rooms.set(outage.roomId, { ...room, roomStatus: outage.returnStatus });
    }

    return { ...outage, released: true } as T;
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
      // 요금 코드를 지정했으면 실재해야 한다. 없는 코드로 잡아 두면 룸리스트가
      // 빠져나갈 때 값을 매길 수 없다.
      if (slot.ratePlanCode) {
        const plan = requirePlan(hotelId, String(slot.ratePlanCode));
        if (plan.baseAmounts[roomType] === undefined && slot.amount === undefined) {
          throw new OperaApiError(
            400,
            { detail: 'RATE_PLAN_ROOM_TYPE' },
            `${plan.ratePlanCode} 로는 ${roomType} 을 팔지 않습니다. 협의 요금을 넣어 주세요.`,
          );
        }
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
          amount: blockAmount(hotelId, slot, String(slot.roomType), date),
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

      /*
       * 협의 요금 조정.
       *
       * 이미 빠져나간 예약의 금액은 건드리지 않는다 — 그 손님과는 그 값으로
       * 합의가 끝났다. 앞으로 빠져나갈 몫만 새 값으로 잡는다.
       */
      const rates = (body.rates ?? []) as Array<Record<string, unknown>>;
      const allocations = existing.roomTypeAllocations.map((slot) => {
        const change = rates.find((row) => String(row.roomType) === slot.roomType);
        if (!change) return slot;
        return {
          ...slot,
          amount: Number(change.amount),
          ...(change.ratePlanCode ? { ratePlanCode: String(change.ratePlanCode) } : {}),
        };
      });

      for (const row of rates) {
        const roomType = String(row.roomType);
        if (!existing.roomTypeAllocations.some((slot) => slot.roomType === roomType)) {
          throw new OperaApiError(
            400,
            { detail: 'NOT_IN_BLOCK' },
            `이 블록이 잡지 않은 객실 타입입니다: ${roomType}`,
          );
        }
      }

      const updated: MockBlock = {
        ...existing,
        blockStatus: nextStatus,
        ...(body.blockName ? { blockName: String(body.blockName) } : {}),
        ...(body.cutoffDate ? { cutoffDate: String(body.cutoffDate) } : {}),
        roomTypeAllocations: allocations,
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

    /*
     * 재고를 넘겨 팔지 않는다.
     *
     * 지금까지 모의 계층은 가용 재고를 안내만 하고 예약은 무조건 받았다. 그러면
     * 화면에 "매진" 이라고 떠 있어도 예약이 만들어져, 재고 판단을 OPERA 에 맡긴
     * 의미가 사라진다.
     *
     * 자리가 없을 때 손님을 그냥 돌려보내지 않으려면 대기로 받는다. 대기 예약은
     * 재고를 차지하지 않고, 자리가 나면 확정으로 올린다.
     */
    const waitlisted = Boolean(roomStay.waitlist);
    if (!waitlisted && availableRooms(hotelId, roomType, arrival, departure) <= 0) {
      throw new OperaApiError(
        409,
        { detail: 'NO_AVAILABILITY' },
        `${roomType} 은 ${arrival} ~ ${departure} 기간에 남은 객실이 없습니다. 대기로 받으려면 waitlist 로 요청해 주세요.`,
      );
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

    /*
     * 요금은 요금 엔진이 정한다.
     *
     * 안내와 청구가 다른 계산을 쓰면 손님이 본 금액과 폴리오에 달리는 금액이
     * 갈린다. 같은 quote() 를 쓰고, 팔 수 없는 조합은 여기서 거절한다.
     */
    const adultCount = Number(roomStay.adultCount ?? 1);
    const ratePlanCode = String(roomStay.ratePlanCode ?? 'BAR').toUpperCase();
    const plan = requirePlan(hotelId, ratePlanCode);
    if (plan.status !== 'Active') {
      throw new OperaApiError(
        400,
        { detail: 'RATE_PLAN_INACTIVE' },
        `중지된 요금 코드입니다: ${plan.ratePlanCode}`,
      );
    }
    if (plan.sellStartDate > arrival || plan.sellEndDate < addDays(departure, -1)) {
      throw new OperaApiError(
        400,
        { detail: 'RATE_PLAN_NOT_SELLABLE' },
        `${plan.ratePlanCode} 는 ${plan.sellStartDate} ~ ${plan.sellEndDate} 기간에만 팝니다.`,
      );
    }
    const priced = quote(plan, roomType, arrival, departure, adultCount);
    if (!priced) {
      throw new OperaApiError(
        400,
        { detail: 'RATE_PLAN_ROOM_TYPE' },
        `${plan.ratePlanCode} 로는 ${roomType} 을 팔지 않습니다.`,
      );
    }

    /*
     * 블록에서 빠져나가면 그 블록의 협의 요금으로 판다.
     *
     * 단체는 값을 따로 합의한다. 정가로 잡으면 합의가 계약서에만 남고 손님은
     * 다른 금액을 낸다. 일자별로 잡아 둔 값을 그대로 더한다.
     */
    let totalAmount = priced.totalAmount;
    if (block) {
      const negotiated = stayDates(arrival, departure).map(
        (date) =>
          block.roomTypeAllocations.find((slot) => slot.date === date && slot.roomType === roomType)
            ?.amount,
      );
      if (negotiated.every((amount) => amount !== undefined)) {
        totalAmount =
          negotiated.reduce((sum, amount) => sum + (amount ?? 0), 0) + priced.packageTotal;
      }
    }

    sequence += 1;
    const created: MockReservation = {
      reservationId: `OPERA-${sequence}`,
      confirmationNumber: `OP${sequence}`,
      hotelId,
      reservationStatus: waitlisted ? 'Waitlisted' : 'Reserved',
      roomStay: {
        arrivalDate: arrival,
        departureDate: departure,
        roomType,
        ratePlanCode: plan.ratePlanCode,
        adultCount,
        childCount: Number(roomStay.childCount ?? 0),
        total: {
          amount: totalAmount,
          currencyCode: priced.currencyCode,
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

  // --- 폴리오 · 거래 -------------------------------------------------------
  const folioListMatch = /\/reservations\/([^/]+)\/folios$/.exec(path);
  if (folioListMatch && method === 'GET') {
    const reservationId = decodeURIComponent(folioListMatch[1] ?? '');
    assertReservationExists(reservationId);

    const list = reservationFolios(reservationId);
    // 아직 하나도 없으면 1번 창구를 열어 돌려준다. 빈 배열을 주면 호출자가
    // 창구가 닫힌 것으로 오해한다.
    if (list.length === 0) ensureFolio(hotelId, reservationId, 1);

    return {
      reservationId,
      folios: reservationFolios(reservationId).map(toFolioPayload),
    } as T;
  }

  if (folioListMatch && method === 'POST') {
    const reservationId = decodeURIComponent(folioListMatch[1] ?? '');
    assertReservationExists(reservationId);

    const existing = reservationFolios(reservationId);
    const used = new Set(existing.map((folio) => folio.window));
    if (used.size === 0) {
      ensureFolio(hotelId, reservationId, 1);
      used.add(1);
    }

    let window = body.window === undefined ? undefined : Number(body.window);
    if (window === undefined) {
      window = 1;
      while (used.has(window) && window <= MAX_FOLIO_WINDOW) window += 1;
    }

    if (window > MAX_FOLIO_WINDOW) {
      throw new OperaApiError(
        400,
        { detail: 'TOO_MANY_WINDOWS' },
        `폴리오 윈도는 ${MAX_FOLIO_WINDOW}개까지만 열 수 있습니다.`,
      );
    }
    if (used.has(window)) {
      throw new OperaApiError(
        409,
        { detail: 'WINDOW_IN_USE' },
        `윈도 ${window} 은 이미 열려 있습니다.`,
      );
    }

    const folioId = `FOL-${(folioSequence += 1)}`;
    const folio: MockFolio = {
      folioId,
      reservationId,
      hotelId,
      window,
      status: 'Open',
      currencyCode: 'KRW',
      postings: [],
    };
    folios.set(folioId, folio);
    return toFolioPayload(folio) as T;
  }

  const postingMatch = /\/reservations\/([^/]+)\/folios\/(\d+)\/postings$/.exec(path);
  if (postingMatch && method === 'POST') {
    const reservationId = decodeURIComponent(postingMatch[1] ?? '');
    assertReservationExists(reservationId);
    const window = Number(postingMatch[2]);
    const folio = ensureFolio(hotelId, reservationId, window);

    if (folio.status === 'Closed') {
      throw new OperaApiError(
        400,
        { detail: 'FOLIO_CLOSED' },
        `윈도 ${window} 은 이미 마감되었습니다.`,
      );
    }

    /*
     * 같은 전표는 한 번만 달린다.
     *
     * 네트워크가 끊겨 POS 가 재전송하는 일은 흔하다. 두 번 달리면 손님에게 두 번
     * 청구되고 되돌리기 어렵다. 이미 있으면 그것을 그대로 돌려준다 — 호출자
     * 입장에서 성공으로 보여야 재시도가 멈춘다.
     */
    const reference = body.reference ? String(body.reference) : undefined;
    if (reference) {
      for (const candidate of reservationFolios(reservationId)) {
        const duplicate = candidate.postings.find((row) => row.reference === reference);
        if (duplicate) return toFolioPayload(candidate) as T;
      }
    }

    const postingId = `PST-${(postingSequence += 1)}`;
    folio.postings.push({
      postingId,
      type: String(body.type ?? ''),
      transactionCode: String(body.transactionCode ?? ''),
      description: String(body.description ?? ''),
      amount: signedAmount(
        String(body.type ?? ''),
        Number(body.amount ?? 0),
        Boolean(body.negative),
      ),
      currencyCode: folio.currencyCode,
      postedAt: new Date().toISOString(),
      ...(reference ? { reference } : {}),
    });

    return toFolioPayload(folio) as T;
  }

  const voidMatch = /\/reservations\/([^/]+)\/folios\/postings\/([^/]+)\/void$/.exec(path);
  if (voidMatch && method === 'POST') {
    const reservationId = decodeURIComponent(voidMatch[1] ?? '');
    assertReservationExists(reservationId);
    const { folio, posting } = findPosting(reservationId, decodeURIComponent(voidMatch[2] ?? ''));

    if (posting.voidedById) {
      throw new OperaApiError(
        409,
        { detail: 'ALREADY_VOIDED' },
        `이미 취소된 거래입니다: ${posting.postingId}`,
      );
    }
    if (folio.status === 'Closed') {
      throw new OperaApiError(
        400,
        { detail: 'FOLIO_CLOSED' },
        '마감된 폴리오의 거래는 취소할 수 없습니다.',
      );
    }

    // 지우지 않고 반대 부호 조정을 단다. 지우면 손님 명세서에서 요금이 통째로
    // 사라져 무엇이 정정됐는지 설명할 수 없다.
    const reversalId = `PST-${(postingSequence += 1)}`;
    folio.postings.push({
      postingId: reversalId,
      type: 'Adjustment',
      transactionCode: posting.transactionCode,
      description: `[취소] ${posting.description}`,
      amount: -posting.amount,
      currencyCode: folio.currencyCode,
      postedAt: new Date().toISOString(),
      ...(body.reference ? { reference: String(body.reference) } : {}),
    });
    posting.voidedById = reversalId;

    return toFolioPayload(folio) as T;
  }

  const transferMatch = /\/reservations\/([^/]+)\/folios\/postings\/([^/]+)\/transfer$/.exec(path);
  if (transferMatch && method === 'POST') {
    const reservationId = decodeURIComponent(transferMatch[1] ?? '');
    assertReservationExists(reservationId);
    const { folio, posting } = findPosting(
      reservationId,
      decodeURIComponent(transferMatch[2] ?? ''),
    );

    const toWindow = Number(body.toWindow ?? 0);
    if (toWindow === folio.window) {
      throw new OperaApiError(
        400,
        { detail: 'SAME_WINDOW' },
        `이미 윈도 ${toWindow} 에 있는 거래입니다.`,
      );
    }

    const target = reservationFolios(reservationId).find((row) => row.window === toWindow);
    if (!target) {
      throw new OperaApiError(
        404,
        { detail: 'FOLIO_NOT_FOUND' },
        `윈도 ${toWindow} 이 열려 있지 않습니다.`,
      );
    }
    if (folio.status === 'Closed' || target.status === 'Closed') {
      throw new OperaApiError(
        400,
        { detail: 'FOLIO_CLOSED' },
        '마감된 폴리오와는 거래를 주고받을 수 없습니다.',
      );
    }

    // 취소된 짝은 함께 있어야 한다. 한쪽만 옮기면 양쪽 잔액이 모두 틀어진다.
    if (posting.voidedById) {
      throw new OperaApiError(400, { detail: 'VOIDED_POSTING' }, '취소된 거래는 옮길 수 없습니다.');
    }
    const isReversal = folio.postings.some((row) => row.voidedById === posting.postingId);
    if (isReversal) {
      throw new OperaApiError(400, { detail: 'VOID_ADJUSTMENT' }, '취소 조정은 옮길 수 없습니다.');
    }

    folio.postings = folio.postings.filter((row) => row.postingId !== posting.postingId);
    target.postings.push({ ...posting, transferredFromWindow: folio.window });

    return {
      reservationId,
      folios: reservationFolios(reservationId).map(toFolioPayload),
    } as T;
  }

  const closeMatch = /\/reservations\/([^/]+)\/folios\/(\d+)\/close$/.exec(path);
  if (closeMatch && method === 'POST') {
    const reservationId = decodeURIComponent(closeMatch[1] ?? '');
    assertReservationExists(reservationId);
    const window = Number(closeMatch[2]);
    // 1번 창구는 예약이 있으면 언제나 존재한다. 거래 등록과 같은 규칙을 쓴다.
    const folio = ensureFolio(hotelId, reservationId, window);

    // 잔액이 남은 폴리오를 닫으면 매출 누락으로 이어진다.
    const balance = folioBalance(folio);
    if (balance !== 0) {
      throw new OperaApiError(
        400,
        { detail: 'FOLIO_NOT_SETTLED' },
        `잔액이 남아 있어 마감할 수 없습니다: ${balance}`,
      );
    }

    folio.status = 'Closed';
    return toFolioPayload(folio) as T;
  }

  // --- 객실 공유 ----------------------------------------------------------
  const shareMatch = /\/reservations\/([^/]+)\/share$/.exec(path);
  if (shareMatch && method === 'POST') {
    const id = decodeURIComponent(shareMatch[1] ?? '');
    const first = store.get(id);
    if (!first) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    const withId = String(body.withReservationId ?? '');
    const second = store.get(withId);
    if (!second) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${withId}`);
    }
    if (first.reservationId === second.reservationId) {
      throw new OperaApiError(
        400,
        { detail: 'SAME_RESERVATION' },
        '같은 예약끼리는 공유할 수 없습니다.',
      );
    }

    for (const r of [first, second]) {
      if (['Cancelled', 'NoShow', 'CheckedOut'].includes(r.reservationStatus)) {
        throw new OperaApiError(
          400,
          { detail: 'INVALID_STATUS' },
          `현재 상태(${r.reservationStatus})의 예약은 공유할 수 없습니다.`,
        );
      }
    }

    // 날짜가 겹치지 않으면 한 방을 함께 쓸 수 없다.
    const overlaps =
      first.roomStay.arrivalDate < second.roomStay.departureDate &&
      second.roomStay.arrivalDate < first.roomStay.departureDate;
    if (!overlaps) {
      throw new OperaApiError(
        400,
        { detail: 'NO_OVERLAP' },
        '투숙 기간이 겹치지 않아 객실을 함께 쓸 수 없습니다.',
      );
    }

    // 타입이 다르면 어느 방을 내줄지 정할 수 없다.
    if (first.roomStay.roomType !== second.roomStay.roomType) {
      throw new OperaApiError(
        400,
        { detail: 'ROOM_TYPE_MISMATCH' },
        `객실 타입이 다릅니다: ${first.roomStay.roomType} / ${second.roomStay.roomType}`,
      );
    }

    /*
     * 이미 배정된 객실이 있으면 그 방으로 맞춘다.
     *
     * 둘이 서로 다른 방에 들어가 있으면 어느 쪽을 옮길지 우리가 정할 수 없다.
     * 한쪽 배정을 먼저 풀고 다시 요청해야 한다.
     */
    const assigned = [first.roomStay.roomId, second.roomStay.roomId].filter(Boolean) as string[];
    if (new Set(assigned).size > 1) {
      throw new OperaApiError(
        409,
        { detail: 'ROOM_CONFLICT' },
        '두 예약이 서로 다른 객실에 배정되어 있습니다. 한쪽 배정을 먼저 풀어 주세요.',
      );
    }
    const sharedRoom = assigned[0];

    const groupId =
      first.roomStay.shareGroupId ?? second.roomStay.shareGroupId ?? `SHR-${(shareSequence += 1)}`;

    for (const r of [first, second]) {
      store.set(r.reservationId, {
        ...r,
        roomStay: {
          ...r.roomStay,
          shareGroupId: groupId,
          ...(sharedRoom ? { roomId: sharedRoom } : {}),
        },
      });
    }

    return {
      shareGroupId: groupId,
      reservations: [first.reservationId, second.reservationId].map(
        (rid) => store.get(rid) as MockReservation,
      ),
    } as T;
  }

  const unshareMatch = /\/reservations\/([^/]+)\/unshare$/.exec(path);
  if (unshareMatch && method === 'POST') {
    const id = decodeURIComponent(unshareMatch[1] ?? '');
    const existing = store.get(id);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }
    const groupId = existing.roomStay.shareGroupId;
    if (!groupId) {
      throw new OperaApiError(400, { detail: 'NOT_SHARED' }, '공유 중인 예약이 아닙니다.');
    }

    store.set(id, { ...existing, roomStay: dropShare(existing.roomStay) });

    /*
     * 혼자 남은 예약의 묶음도 푼다.
     *
     * 그대로 두면 공유가 아닌데 공유 표시가 남아, 나중에 다른 예약을 붙일 때
     * 어느 묶음인지 헷갈린다.
     */
    const remaining = [...store.values()].filter((r) => r.roomStay.shareGroupId === groupId);
    if (remaining.length === 1) {
      const only = remaining[0]!;
      store.set(only.reservationId, { ...only, roomStay: dropShare(only.roomStay) });
    }

    return store.get(id) as T;
  }

  // --- 대기 확정 ----------------------------------------------------------
  const confirmMatch = /\/reservations\/([^/]+)\/confirmWaitlist$/.exec(path);
  if (confirmMatch && method === 'POST') {
    const id = decodeURIComponent(confirmMatch[1] ?? '');
    const existing = store.get(id);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    if (existing.reservationStatus !== 'Waitlisted') {
      throw new OperaApiError(
        400,
        { detail: 'NOT_WAITLISTED' },
        `대기 상태가 아닙니다: ${existing.reservationStatus}`,
      );
    }

    /*
     * 확정 시점에 재고를 다시 본다.
     *
     * 대기에 올릴 때 자리가 없었다는 사실은 지금과 무관하다. 자리가 났는지는
     * 지금 세어 봐야 알고, 그 사이 다른 대기 건이 먼저 확정됐을 수도 있다.
     */
    const { arrivalDate, departureDate, roomType } = existing.roomStay;
    if (availableRooms(hotelId, roomType, arrivalDate, departureDate) <= 0) {
      throw new OperaApiError(
        409,
        { detail: 'NO_AVAILABILITY' },
        `아직 ${roomType} 에 빈 객실이 없습니다.`,
      );
    }

    const updated: MockReservation = { ...existing, reservationStatus: 'Confirmed' };
    store.set(id, updated);
    return updated as T;
  }

  // --- 체크인 / 체크아웃 --------------------------------------------------
  const checkInMatch = /\/reservations\/([^/]+)\/checkIn$/.exec(path);
  if (checkInMatch && method === 'POST') {
    const id = decodeURIComponent(checkInMatch[1] ?? '');
    const existing = store.get(id);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    if (!CHECK_IN_FROM.includes(existing.reservationStatus)) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_STATUS_TRANSITION' },
        `현재 상태(${existing.reservationStatus})에서는 체크인할 수 없습니다.`,
      );
    }

    const businessDate = businessDates.get(hotelId) ?? dayOffset(0);
    // 도착일 전에 체크인하면 그날 밤 재고가 팔린 것으로 잡히지 않는다.
    if (existing.roomStay.arrivalDate > businessDate) {
      throw new OperaApiError(
        400,
        { detail: 'ARRIVAL_NOT_DUE' },
        `도착일(${existing.roomStay.arrivalDate})이 되지 않아 체크인할 수 없습니다.`,
      );
    }

    const roomId = String(body.roomId ?? '');
    if (!roomId) {
      throw new OperaApiError(
        400,
        { detail: 'ROOM_REQUIRED' },
        '체크인하려면 객실을 배정해야 합니다.',
      );
    }
    assertRoomAssignable(
      hotelId,
      roomId,
      existing.roomStay.arrivalDate,
      existing.roomStay.departureDate,
    );

    /*
     * 다른 손님이 들어 있는 방에 또 넣을 수는 없다.
     *
     * 객실을 함께 쓰기로 한 예약은 예외다 — 두 손님이 한 방을 쓰되 계산만
     * 따로 하는 편성이 공유다.
     */
    const takenBy = [...store.values()].find(
      (r) =>
        r.reservationId !== id &&
        r.hotelId === hotelId &&
        r.reservationStatus === 'InHouse' &&
        r.roomStay.roomId === roomId &&
        !(
          existing.roomStay.shareGroupId !== undefined &&
          r.roomStay.shareGroupId === existing.roomStay.shareGroupId
        ),
    );
    if (takenBy) {
      throw new OperaApiError(
        409,
        { detail: 'ROOM_OCCUPIED' },
        `객실 ${roomId} 은 예약 ${takenBy.confirmationNumber} 이 사용 중입니다.`,
      );
    }

    const updated: MockReservation = {
      ...existing,
      reservationStatus: 'InHouse',
      roomStay: { ...existing.roomStay, roomId },
    };
    store.set(id, updated);

    const room = rooms.get(roomId);
    if (room) rooms.set(roomId, { ...room, occupied: true });

    return updated as T;
  }

  const checkOutMatch = /\/reservations\/([^/]+)\/checkOut$/.exec(path);
  if (checkOutMatch && method === 'POST') {
    const id = decodeURIComponent(checkOutMatch[1] ?? '');
    const existing = store.get(id);
    if (!existing) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    if (existing.reservationStatus !== 'InHouse') {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_STATUS_TRANSITION' },
        `현재 상태(${existing.reservationStatus})에서는 체크아웃할 수 없습니다.`,
      );
    }

    const updated: MockReservation = { ...existing, reservationStatus: 'CheckedOut' };
    store.set(id, updated);

    // 나간 방은 비고 청소가 필요하다. 청소 완료로 두면 치우지 않은 방이 팔린다.
    const roomId = existing.roomStay.roomId;
    const room = roomId ? rooms.get(roomId) : undefined;
    if (roomId && room) rooms.set(roomId, { ...room, occupied: false, roomStatus: 'Dirty' });

    return updated as T;
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

      // 객실을 배정하려면 그 기간에 팔 수 있는 객실이어야 한다. 공사 중인 방에
      // 손님을 넣어 두면 도착 당일에야 알게 된다.
      if (roomStay.roomId) {
        assertRoomAssignable(
          hotelId,
          String(roomStay.roomId),
          String(roomStay.arrivalDate ?? existing.roomStay.arrivalDate),
          String(roomStay.departureDate ?? existing.roomStay.departureDate),
        );
      }

      const updated: MockReservation = {
        ...existing,
        ...(nextStatus ? { reservationStatus: nextStatus } : {}),
        roomStay: {
          ...existing.roomStay,
          ...(roomStay.arrivalDate ? { arrivalDate: String(roomStay.arrivalDate) } : {}),
          ...(roomStay.departureDate ? { departureDate: String(roomStay.departureDate) } : {}),
          ...(roomStay.roomId ? { roomId: String(roomStay.roomId) } : {}),
          ...(roomStay.roomType ? { roomType: String(roomStay.roomType) } : {}),
          ...(roomStay.ratePlanCode ? { ratePlanCode: String(roomStay.ratePlanCode) } : {}),
          ...(roomStay.adultCount === undefined ? {} : { adultCount: Number(roomStay.adultCount) }),
          ...(roomStay.childCount === undefined ? {} : { childCount: Number(roomStay.childCount) }),
        },
      };
      /*
       * 고치면 다시 매긴다.
       *
       * 날짜나 객실 타입이 바뀌면 요금도 바뀐다. 예전 총액을 그대로 두면 손님이
       * 3박으로 늘렸는데 2박 값만 청구된다.
       */
      const updatedPlan = requirePlan(hotelId, updated.roomStay.ratePlanCode ?? 'BAR');
      const repriced = quote(
        updatedPlan,
        updated.roomStay.roomType,
        updated.roomStay.arrivalDate,
        updated.roomStay.departureDate,
        updated.roomStay.adultCount ?? 1,
      );
      if (!repriced) {
        throw new OperaApiError(
          400,
          { detail: 'RATE_PLAN_ROOM_TYPE' },
          `${updatedPlan.ratePlanCode} 로는 ${updated.roomStay.roomType} 을 팔지 않습니다.`,
        );
      }
      updated.roomStay.total = {
        amount: repriced.totalAmount,
        currencyCode: repriced.currencyCode,
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
  roomOutages.clear();
  folios.clear();
  blocks.clear();
  businessDates.clear();
  profiles.clear();
  ratePlans.clear();
  packages.clear();
  transactionCodes.clear();
  sequence = SEQUENCE_START;
  blockSequence = BLOCK_SEQUENCE_START;
  outageSequence = OUTAGE_SEQUENCE_START;
  shareSequence = SHARE_SEQUENCE_START;
  folioSequence = FOLIO_SEQUENCE_START;
  postingSequence = FOLIO_SEQUENCE_START;
}
