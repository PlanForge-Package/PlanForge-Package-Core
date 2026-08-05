import { OperaApiError } from './errors.js';

/**
 * In-memory OPERA store and rate engine.
 *
 * Split out of the transport because they answer different questions: this file is
 * what OPERA *knows* — reservations, folios, blocks, rate plans, policies — while the
 * transport is only the routing table that reaches it. Growing OHIP coverage adds
 * handlers over there; it does not push this file further down the screen.
 *
 * The stores are module-level and mutable on purpose: a mock is allowed to be a
 * singleton, and `resetMockStore` gives tests a clean slate between cases.
 */

export interface MockReservation {
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
    /** Block code, if this reservation was picked up from a group block. */
    blockCode?: string;
    /**
     * Reservations that share one room.
     *
     * Two guests, one room, separate folios. Two reservations but only one room,
     * so they consume a single unit of inventory.
     */
    shareGroupId?: string;
  };
  guest: { profileId: string; givenName: string; surname: string; email?: string };
  sourceOfBusiness: { sourceCode: string; marketCode: string; channelCode?: string };
  /**
   * Guarantee type.
   *
   * Decides what we can charge on a no-show. 6PM only holds the room until 18:00;
   * a card guarantee lets us post a no-show fee.
   */
  guaranteeCode?: string;
  /** Penalty charged on cancellation. Present only on cancelled reservations. */
  cancellationPenalty?: number;
}

/**
 * Source-of-business codes OPERA knows.
 *
 * Real hotels configure these, but accepting any string lets a typo into the
 * reports, where BOOKINGCOM and BOOKING.COM become two different channels.
 */
export const SOURCE_CODES = ['DIRECT', 'PHONE', 'WALKIN', 'OTA', 'GDS', 'CORPORATE'];
export const MARKET_CODES = ['TRANSIENT', 'CORPORATE', 'GROUP', 'LEISURE', 'GOVERNMENT'];
export const CHANNEL_CODES = [
  'WEB',
  'MOBILE',
  'BOOKINGCOM',
  'EXPEDIA',
  'AGODA',
  'YANOLJA',
  'FRONTDESK',
];

/** Mock store. Lives only as long as the process. */
export const store = new Map<string, MockReservation>();

/**
 * Where new reservation ids start.
 *
 * Must sit above the seeded 1001/1002. Overlapping ids let a new reservation
 * overwrite a seeded one, and inventory and lists drift apart silently.
 */
const SEQUENCE_START = 2000;

export function seed(): void {
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

export function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Room statuses OPERA accepts. */
export const ROOM_STATUSES = ['Clean', 'Dirty', 'Inspected', 'OutOfOrder', 'OutOfService'];

/** Base rate per room type. Real pricing comes from OPERA's rate engine. */
export const RATES: Record<string, number> = { STDT: 190000, DLXK: 240000, SUIT: 400000 };
export const ROOM_TYPE_NAMES: Record<string, string> = {
  STDT: 'Standard Twin',
  DLXK: 'Deluxe King',
  SUIT: 'Suite',
};

export function nights(arrival: string, departure: string): number {
  const from = Date.parse(`${arrival}T00:00:00Z`);
  const to = Date.parse(`${departure}T00:00:00Z`);
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

// --- Rate engine -----------------------------------------------------------

/**
 * Overrides the base rate by date range and weekday.
 *
 * High season and weekends cost more for the same room. A total alone cannot
 * explain why a night is expensive, so we price day by day.
 */
export interface MockRateSeason {
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string;
  /** 0 = Sunday. Empty means every day in the range. */
  daysOfWeek?: number[];
  amounts: Record<string, number>;
}

/**
 * Cancellation policy.
 *
 * How long cancelling is free and what it costs after that. The guest was told
 * this up front, so it belongs to the rate — a cheaper rate cancels harder.
 */
interface MockCancellationPolicy {
  name: string;
  /** Hours before arrival that cancelling is still free. 0 means same-day is free. */
  freeUntilHoursBeforeArrival: number;
  /** None, FirstNight, FullStay, Percent, Fixed. */
  penaltyType: string;
  /** Ratio for Percent (0.5 = 50%), amount for Fixed. Unused otherwise. */
  penaltyValue: number;
}

/**
 * Deposit policy.
 *
 * Money taken up front to hold the booking. Without it a no-show is a pure loss.
 */
interface MockDepositPolicy {
  /** None, FirstNight, Percent of total, Fixed amount. */
  type: string;
  value: number;
  /** How many days before arrival it is due. */
  dueDaysBeforeArrival: number;
}

export interface MockRatePlan {
  ratePlanCode: string;
  hotelId: string;
  name: string;
  description?: string;
  currencyCode: string;
  marketCode: string;
  /** Sell window. Dates outside it cannot be sold on this rate. */
  sellStartDate: string;
  sellEndDate: string;
  /** Base amount per room type. A room type missing here is not sold on this rate. */
  baseAmounts: Record<string, number>;
  seasons: MockRateSeason[];
  packageCodes: string[];
  status: string;
  cancellationPolicy: MockCancellationPolicy;
  depositPolicy: MockDepositPolicy;
}

/**
 * Add-on sold with the rate.
 *
 * `includedInRate` means it is already inside the rate, so the total does not
 * grow. Miss that and breakfast gets charged twice.
 */
export interface MockPackage {
  packageCode: string;
  hotelId: string;
  name: string;
  amount: number;
  /** PerNight, PerStay (once), or PerPerson (per person per night). */
  calculation: string;
  transactionCode: string;
  includedInRate: boolean;
}

export const ratePlans = new Map<string, MockRatePlan>();
export const packages = new Map<string, MockPackage>();

/**
 * Transaction code.
 *
 * The basis for the closing journal. It decides which revenue group an amount
 * lands in and how tax applies; an unconfigured code cannot be classified.
 *
 * Korean hotels sell at tax-inclusive prices, so we keep the amount as posted and
 * split net, VAT and service charge at closing. Adding tax on top would make the
 * charge differ from the price the guest was quoted.
 */
export interface MockTransactionCode {
  transactionCode: string;
  hotelId: string;
  name: string;
  /** Room, FoodBeverage, Other, Payment. */
  group: string;
  /** VAT rate. 0.1 means 10%. */
  vatRate: number;
  /** Service charge rate. Usually 10% for F&B, 0 for rooms. */
  serviceChargeRate: number;
  /** True when tax is already inside the displayed price. */
  taxInclusive: boolean;
  active: boolean;
}

export const transactionCodes = new Map<string, MockTransactionCode>();

export function planKey(hotelId: string, code: string): string {
  return `${hotelId}::${code.toUpperCase()}`;
}

export function seedTransactionCodes(): void {
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

export function seedRates(): void {
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
      cancellationPolicy: {
        name: '도착 1일 전 18시까지 무료',
        freeUntilHoursBeforeArrival: 30,
        penaltyType: 'FirstNight',
        penaltyValue: 0,
      },
      depositPolicy: { type: 'None', value: 0, dueDaysBeforeArrival: 0 },
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
      // Corporate rates cancel freely; that is what the lower price buys.
      cancellationPolicy: {
        name: '당일 취소까지 무료',
        freeUntilHoursBeforeArrival: 0,
        penaltyType: 'None',
        penaltyValue: 0,
      },
      depositPolicy: { type: 'None', value: 0, dueDaysBeforeArrival: 0 },
    },
  ];

  for (const plan of plans) {
    ratePlans.set(planKey(plan.hotelId, plan.ratePlanCode), plan);
  }
  counters.season = 4;
}

/**
 * Stops two seasons covering the same room on the same day.
 *
 * Overlapping seasons make the winner depend on insert order, and a peak Friday
 * can end up cheaper than a weekday. Split by weekday and register separately.
 */
export function assertNoSeasonConflict(plan: MockRatePlan, candidate: MockRateSeason): void {
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
 * Nightly amount for that room on that date.
 *
 * The last matching season wins — narrowing a wide range is the usual order in
 * rate setup.
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

export interface Quote {
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

/** Prices a stay. One place only, so the quote and the charge agree. */
export function quote(
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
    // Per-stay packages attach to the first night; every night would multiply them.
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
 * Block amount for that room on that date.
 *
 * A negotiated amount wins — groups agree their own price and that agreement
 * beats rack rate. Without one, follow the named rate plan; without that,
 * fall back to the base rate.
 */
export function blockAmount(
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

/** Rate plans that can be sold for this stay. */
export function sellablePlans(hotelId: string, arrival: string, departure: string): MockRatePlan[] {
  const lastNight = addDays(departure, -1);
  return [...ratePlans.values()].filter(
    (plan) =>
      plan.hotelId === hotelId &&
      plan.status === 'Active' &&
      plan.sellStartDate <= arrival &&
      plan.sellEndDate >= lastNight,
  );
}

const PENALTY_TYPES = ['None', 'FirstNight', 'FullStay', 'Percent', 'Fixed'];
const DEPOSIT_TYPES = ['None', 'FirstNight', 'Percent', 'Fixed'];

export function readCancellationPolicy(raw: unknown): MockCancellationPolicy {
  const value = (raw ?? {}) as Record<string, unknown>;
  const penaltyType = String(value.penaltyType ?? 'None');
  assertCode(PENALTY_TYPES, penaltyType, '위약금 유형');

  return {
    name: String(value.name ?? '취소 자유'),
    freeUntilHoursBeforeArrival: Number(value.freeUntilHoursBeforeArrival ?? 0),
    penaltyType,
    penaltyValue: Number(value.penaltyValue ?? 0),
  };
}

export function readDepositPolicy(raw: unknown): MockDepositPolicy {
  const value = (raw ?? {}) as Record<string, unknown>;
  const type = String(value.type ?? 'None');
  assertCode(DEPOSIT_TYPES, type, '보증금 유형');

  return {
    type,
    value: Number(value.value ?? 0),
    dueDaysBeforeArrival: Number(value.dueDaysBeforeArrival ?? 0),
  };
}

/** Guarantee types OPERA accepts. They decide how a no-show is handled. */
export const GUARANTEE_CODES = ['SIXPM', 'CREDITCARD', 'DEPOSIT', 'COMPANY', 'COMP'];

/** Transaction codes for cancellation penalties and deposits. */
export const CANCELLATION_FEE_CODE = '8000';
export const DEPOSIT_CODE = '8100';

/**
 * Deadline for free cancellation.
 *
 * Midnight on the arrival date, moved back by the policy hours. "18:00 the day
 * before" is 30 hours, so hotels with different cut-offs share one field.
 */
function freeCancellationUntil(arrival: string, hours: number): string {
  const at = new Date(`${arrival}T00:00:00.000Z`);
  at.setUTCHours(at.getUTCHours() - hours);
  return at.toISOString();
}

/**
 * Cancellation penalty.
 *
 * Zero inside the free window. Past it, apply the policy — first night, full
 * stay, percentage or fixed. An already-cancelled reservation is not charged again.
 */
export function cancellationPenalty(
  reservation: MockReservation,
  plan: MockRatePlan | undefined,
  now: Date,
): { policyName: string; freeUntil: string; withinFreeWindow: boolean; amount: number } {
  const policy = plan?.cancellationPolicy ?? {
    name: '규정 없음',
    freeUntilHoursBeforeArrival: 0,
    penaltyType: 'None',
    penaltyValue: 0,
  };

  const freeUntil = freeCancellationUntil(
    reservation.roomStay.arrivalDate,
    policy.freeUntilHoursBeforeArrival,
  );
  const withinFreeWindow = now.toISOString() <= freeUntil;

  const total = reservation.roomStay.total?.amount ?? 0;
  const stayNights = Math.max(
    1,
    nights(reservation.roomStay.arrivalDate, reservation.roomStay.departureDate),
  );

  let amount = 0;
  if (!withinFreeWindow) {
    switch (policy.penaltyType) {
      case 'FirstNight':
        amount = Math.round(total / stayNights);
        break;
      case 'FullStay':
        amount = total;
        break;
      case 'Percent':
        amount = Math.round(total * policy.penaltyValue);
        break;
      case 'Fixed':
        amount = policy.penaltyValue;
        break;
      default:
        amount = 0;
    }
  }

  return { policyName: policy.name, freeUntil, withinFreeWindow, amount };
}

/** Deposit required for a reservation. Zero when no policy applies. */
export function depositRequired(
  reservation: MockReservation,
  plan: MockRatePlan | undefined,
): { amount: number; dueDate?: string } {
  const policy = plan?.depositPolicy;
  if (!policy || policy.type === 'None') return { amount: 0 };

  const total = reservation.roomStay.total?.amount ?? 0;
  const stayNights = Math.max(
    1,
    nights(reservation.roomStay.arrivalDate, reservation.roomStay.departureDate),
  );

  const amount =
    policy.type === 'FirstNight'
      ? Math.round(total / stayNights)
      : policy.type === 'Percent'
        ? Math.round(total * policy.value)
        : policy.type === 'Fixed'
          ? policy.value
          : 0;

  return {
    amount,
    dueDate: addDays(reservation.roomStay.arrivalDate, -policy.dueDaysBeforeArrival),
  };
}

/**
 * Finds the rate plan to price a reservation with.
 *
 * Accepting an unknown rate code creates a zero-amount reservation, and nobody
 * notices until the guest checks out.
 */
export function requirePlan(hotelId: string, code: string): MockRatePlan {
  const plan = ratePlans.get(planKey(hotelId, code));
  if (!plan) {
    throw new OperaApiError(400, { detail: 'INVALID_RATE_PLAN' }, `알 수 없는 요금 코드: ${code}`);
  }
  return plan;
}

/** Mock room state. OPERA owns this for real. */
export const rooms = new Map<string, { roomStatus: string; occupied: boolean; roomType: string }>();

export interface MockRoomOutage {
  outageId: string;
  hotelId: string;
  roomId: string;
  /** OutOfOrder removes it from inventory; OutOfService only stops selling it. */
  kind: string;
  startDate: string;
  endDate: string;
  reason: string;
  returnStatus: string;
}

/** Room outages. They cut inventory, so they live as long as reservations do. */
export const roomOutages = new Map<string, MockRoomOutage>();

interface MockPosting {
  postingId: string;
  type: string;
  transactionCode: string;
  description: string;
  /** Signed amount: charges positive, payments negative. */
  amount: number;
  currencyCode: string;
  postedAt: string;
  reference?: string;
  voidedById?: string;
  transferredFromWindow?: number;
}

export interface MockFolio {
  folioId: string;
  reservationId: string;
  hotelId: string;
  window: number;
  status: string;
  currencyCode: string;
  postings: MockPosting[];
}

/**
 * Mock folio ledger.
 *
 * Balances are not stored. We re-sum the postings every time — incremental
 * updates turn one failed write into a permanent discrepancy.
 */
export const folios = new Map<string, MockFolio>();

const FOLIO_SEQUENCE_START = 800;

const OUTAGE_SEQUENCE_START = 700;

/** Share group id. */
const SHARE_SEQUENCE_START = 900;

/** roomStay with the share marker removed. Everything else stays. */
export function dropShare(roomStay: MockReservation['roomStay']): MockReservation['roomStay'] {
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

export interface MockBlock {
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

export const blocks = new Map<string, MockBlock>();

/**
 * Business date per hotel.
 *
 * The mock has no night audit, so it matches the calendar date. In practice it
 * stays on yesterday until close, and that gap decides which day revenue lands on.
 */
export const businessDates = new Map<string, string>();

export interface MockProfile {
  profileId: string;
  givenName?: string;
  surname?: string;
  email?: string;
  mergedIntoId?: string;
}

/**
 * Mock profile store.
 *
 * Filled when a reservation is created. Verifying merges needs profiles to exist
 * independently of reservations.
 */
export const profiles = new Map<string, MockProfile>();

export function rememberProfile(guest: MockReservation['guest']): void {
  if (!guest.profileId || profiles.has(guest.profileId)) return;
  profiles.set(guest.profileId, {
    profileId: guest.profileId,
    givenName: guest.givenName,
    surname: guest.surname,
    email: guest.email,
  });
}

/** Block ids start clear of the seeds, same as reservations. */
const BLOCK_SEQUENCE_START = 500;

/**
 * Id counters for the mock.
 *
 * Grouped in one object rather than seven module-level `let`s so the transport can
 * bump them across the module boundary — an imported binding is read-only, a property
 * on an imported object is not. `resetMockStore` puts them all back at once.
 */
export const counters = {
  reservation: SEQUENCE_START,
  season: 0,
  folio: FOLIO_SEQUENCE_START,
  posting: FOLIO_SEQUENCE_START,
  outage: OUTAGE_SEQUENCE_START,
  share: SHARE_SEQUENCE_START,
  block: BLOCK_SEQUENCE_START,
};

/** Blocks hold inventory per night. The departure date itself is not included. */
export function stayDates(startDate: string, endDate: string): string[] {
  const count = nights(startDate, endDate);
  return Array.from({ length: count }, (_, i) => addDays(startDate, i));
}

export function seedBlocks(): void {
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
 * Checks whether this reservation can be picked up from the block.
 *
 * Letting through a room type or date the block never held shows the reservation
 * on the rooming list while pickup stays at zero. Once those two disagree there
 * is no basis for deciding what to release at cut-off, so we reject it.
 */
export function assertPickupPossible(
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
 * Raises pickup for that date and room type when a booking cites a block code.
 *
 * Without it there is no way to tell how much of the block is used. Real OPERA
 * updates at booking time too. Callers filter with assertPickupPossible first.
 */
export function applyPickup(
  block: MockBlock,
  roomType: string,
  arrival: string,
  departure: string,
): void {
  for (const date of stayDates(arrival, departure)) {
    const slot = block.roomTypeAllocations.find((a) => a.date === date && a.roomType === roomType);
    if (slot) slot.roomsPickedUp += 1;
  }
}

export function seedRooms(): void {
  if (rooms.size > 0) return;
  // Number, housekeeping status, occupancy, room type. Same layout as the BE seed.
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

export function seedOutages(): void {
  if (roomOutages.size > 0) return;
  // Records why seeded room 1502 is out of order. A status with no dates leaves
  // nobody knowing when it can be sold again.
  const outageId = `OOO-${(counters.outage += 1)}`;
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

/** Does the outage touch the stay (arrival through the night before departure)? */
function outageOverlapsStay(outage: MockRoomOutage, arrival: string, departure: string): boolean {
  const lastNight = addDays(departure, -1);
  return outage.startDate <= lastNight && outage.endDate >= arrival;
}

/** Is the room out on that date? Start and end are both inclusive. */
export function outageCoversDate(outage: MockRoomOutage, date: string): boolean {
  return outage.startDate <= date && outage.endDate >= date;
}

/** The balance is always the sum of postings, cut to two decimals. */
export function folioBalance(folio: MockFolio): number {
  const total = folio.postings.reduce((sum, posting) => sum + posting.amount, 0);
  return Math.round(total * 100) / 100;
}

export function toFolioPayload(folio: MockFolio) {
  return { ...folio, balance: folioBalance(folio) };
}

export function reservationFolios(reservationId: string): MockFolio[] {
  return [...folios.values()]
    .filter((folio) => folio.reservationId === reservationId)
    .sort((a, b) => a.window - b.window);
}

/**
 * Finds the reservation's folio, opening window 1 when there is none.
 *
 * OPERA creates a folio with the reservation. Rather than seeding one for every
 * reservation, we open it on first use — the outside behaviour is the same.
 */
export function ensureFolio(hotelId: string, reservationId: string, window: number): MockFolio {
  const existing = reservationFolios(reservationId).find((folio) => folio.window === window);
  if (existing) return existing;

  if (window !== 1) {
    throw new OperaApiError(
      404,
      { detail: 'FOLIO_NOT_FOUND' },
      `윈도 ${window} 이 열려 있지 않습니다.`,
    );
  }

  const folioId = `FOL-${(counters.folio += 1)}`;
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

/** Inventory per room type. Real values come from hotel configuration. */
const INVENTORY: Record<string, number> = { STDT: 10, DLXK: 10, SUIT: 4 };

/**
 * Rooms sellable for that stay.
 *
 * Quoting availability and accepting a booking must use the same count. Split
 * them and the screen can say sold out while the booking still goes through.
 *
 * Waitlisted reservations do not count — waiting means not holding a room.
 */
export function availableRooms(
  hotelId: string,
  roomType: string,
  arrival: string,
  departure: string,
): number {
  /*
   * Shared reservations count as one room.
   *
   * Two reservations, one room. Counting both burns inventory faster than
   * reality and leaves sellable rooms unsold.
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

/** The posting type decides which way the balance moves. */
export function signedAmount(type: string, amount: number, negative?: boolean): number {
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

export function findPosting(
  reservationId: string,
  postingId: string,
): { folio: MockFolio; posting: MockPosting } {
  for (const folio of reservationFolios(reservationId)) {
    const posting = folio.postings.find((row) => row.postingId === postingId);
    if (posting) return { folio, posting };
  }
  throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `거래를 찾을 수 없습니다: ${postingId}`);
}

/** Is the room sellable for that stay? An overlapping outage blocks assignment. */
export function assertRoomAssignable(
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
 * Rejects codes that are not configured.
 *
 * Letting them through puts typos straight into the reports, where BOOKINGCOM
 * and BOOKING.COM become two channels. Channel performance stops being trusted.
 */
export function assertCode(allowed: string[], value: string, label: string): void {
  if (!allowed.includes(value)) {
    throw new OperaApiError(
      400,
      { detail: 'INVALID_CODE' },
      `알 수 없는 ${label} 코드입니다: ${value}. 가능한 값: ${allowed.join(', ')}`,
    );
  }
}

/** Statuses that can become a no-show. A guest already in house did show up. */
const NO_SHOW_FROM = ['Reserved', 'Confirmed', 'Waitlisted'];

/** Statuses that can check in. A cancelled or no-show booking gets no room. */
export const CHECK_IN_FROM = ['Reserved', 'Confirmed'];

/** OPERA allows up to eight folio windows per reservation. */
export const MAX_FOLIO_WINDOW = 8;

export function assertReservationExists(reservationId: string): void {
  if (!store.has(reservationId)) {
    throw new OperaApiError(
      404,
      { detail: 'NOT_FOUND' },
      `예약을 찾을 수 없습니다: ${reservationId}`,
    );
  }
}

export function assertNoShowAllowed(reservation: MockReservation, businessDate: string): void {
  if (!NO_SHOW_FROM.includes(reservation.reservationStatus)) {
    throw new OperaApiError(
      400,
      { detail: 'INVALID_STATUS_TRANSITION' },
      `현재 상태(${reservation.reservationStatus})에서는 노쇼 처리할 수 없습니다.`,
    );
  }

  // Marking a future arrival as a no-show destroys sellable inventory and there is
  // no basis for a fee. The business date has to reach the arrival date first.
  if (reservation.roomStay.arrivalDate > businessDate) {
    throw new OperaApiError(
      400,
      { detail: 'ARRIVAL_NOT_DUE' },
      `도착일(${reservation.roomStay.arrivalDate})이 지나지 않아 노쇼로 처리할 수 없습니다.`,
    );
  }
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Used by tests to reset state. */
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
  counters.reservation = SEQUENCE_START;
  counters.season = 0;
  counters.folio = FOLIO_SEQUENCE_START;
  counters.posting = FOLIO_SEQUENCE_START;
  counters.outage = OUTAGE_SEQUENCE_START;
  counters.share = SHARE_SEQUENCE_START;
  counters.block = BLOCK_SEQUENCE_START;
}
