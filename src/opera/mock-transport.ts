import { OperaApiError } from './errors.js';
import type { OperaRequestOptions } from './client.js';

/**
 * Mock OHIP transport.
 *
 * Lets us build and verify FE and BE end to end without a subscription spec or
 * credentials. It returns OPERA-shaped raw responses, so the route mappers run
 * exactly as they will against live. Only this layer changes when we cut over.
 *
 * Field names here follow common OHIP conventions but are a guess. When the real
 * spec arrives, fix this file and the route mappers together.
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
const SOURCE_CODES = ['DIRECT', 'PHONE', 'WALKIN', 'OTA', 'GDS', 'CORPORATE'];
const MARKET_CODES = ['TRANSIENT', 'CORPORATE', 'GROUP', 'LEISURE', 'GOVERNMENT'];
const CHANNEL_CODES = ['WEB', 'MOBILE', 'BOOKINGCOM', 'EXPEDIA', 'AGODA', 'YANOLJA', 'FRONTDESK'];

/** Mock store. Lives only as long as the process. */
const store = new Map<string, MockReservation>();

/**
 * Where new reservation ids start.
 *
 * Must sit above the seeded 1001/1002. Overlapping ids let a new reservation
 * overwrite a seeded one, and inventory and lists drift apart silently.
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

/** Room statuses OPERA accepts. */
const ROOM_STATUSES = ['Clean', 'Dirty', 'Inspected', 'OutOfOrder', 'OutOfService'];

/** Base rate per room type. Real pricing comes from OPERA's rate engine. */
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

// --- Rate engine -----------------------------------------------------------

/**
 * Overrides the base rate by date range and weekday.
 *
 * High season and weekends cost more for the same room. A total alone cannot
 * explain why a night is expensive, so we price day by day.
 */
interface MockRateSeason {
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

interface MockRatePlan {
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
interface MockPackage {
  packageCode: string;
  hotelId: string;
  name: string;
  amount: number;
  /** PerNight, PerStay (once), or PerPerson (per person per night). */
  calculation: string;
  transactionCode: string;
  includedInRate: boolean;
}

const ratePlans = new Map<string, MockRatePlan>();
const packages = new Map<string, MockPackage>();
let seasonSequence = 0;

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
interface MockTransactionCode {
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
  seasonSequence = 4;
}

/**
 * Stops two seasons covering the same room on the same day.
 *
 * Overlapping seasons make the winner depend on insert order, and a peak Friday
 * can end up cheaper than a weekday. Split by weekday and register separately.
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

/** Prices a stay. One place only, so the quote and the charge agree. */
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

/** Rate plans that can be sold for this stay. */
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

const PENALTY_TYPES = ['None', 'FirstNight', 'FullStay', 'Percent', 'Fixed'];
const DEPOSIT_TYPES = ['None', 'FirstNight', 'Percent', 'Fixed'];

function readCancellationPolicy(raw: unknown): MockCancellationPolicy {
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

function readDepositPolicy(raw: unknown): MockDepositPolicy {
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
const GUARANTEE_CODES = ['SIXPM', 'CREDITCARD', 'DEPOSIT', 'COMPANY', 'COMP'];

/** Transaction codes for cancellation penalties and deposits. */
const CANCELLATION_FEE_CODE = '8000';
const DEPOSIT_CODE = '8100';

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
function cancellationPenalty(
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
function depositRequired(
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
function requirePlan(hotelId: string, code: string): MockRatePlan {
  const plan = ratePlans.get(planKey(hotelId, code));
  if (!plan) {
    throw new OperaApiError(400, { detail: 'INVALID_RATE_PLAN' }, `알 수 없는 요금 코드: ${code}`);
  }
  return plan;
}

/** Mock room state. OPERA owns this for real. */
const rooms = new Map<string, { roomStatus: string; occupied: boolean; roomType: string }>();

interface MockRoomOutage {
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
const roomOutages = new Map<string, MockRoomOutage>();

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
 * Mock folio ledger.
 *
 * Balances are not stored. We re-sum the postings every time — incremental
 * updates turn one failed write into a permanent discrepancy.
 */
const folios = new Map<string, MockFolio>();

const FOLIO_SEQUENCE_START = 800;
let folioSequence = FOLIO_SEQUENCE_START;
let postingSequence = FOLIO_SEQUENCE_START;

const OUTAGE_SEQUENCE_START = 700;
let outageSequence = OUTAGE_SEQUENCE_START;

/** Share group id. */
const SHARE_SEQUENCE_START = 900;
let shareSequence = SHARE_SEQUENCE_START;

/** roomStay with the share marker removed. Everything else stays. */
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
 * Business date per hotel.
 *
 * The mock has no night audit, so it matches the calendar date. In practice it
 * stays on yesterday until close, and that gap decides which day revenue lands on.
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
 * Mock profile store.
 *
 * Filled when a reservation is created. Verifying merges needs profiles to exist
 * independently of reservations.
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

/** Block ids start clear of the seeds, same as reservations. */
const BLOCK_SEQUENCE_START = 500;
let blockSequence = BLOCK_SEQUENCE_START;

/** Blocks hold inventory per night. The departure date itself is not included. */
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
 * Checks whether this reservation can be picked up from the block.
 *
 * Letting through a room type or date the block never held shows the reservation
 * on the rooming list while pickup stays at zero. Once those two disagree there
 * is no basis for deciding what to release at cut-off, so we reject it.
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
 * Raises pickup for that date and room type when a booking cites a block code.
 *
 * Without it there is no way to tell how much of the block is used. Real OPERA
 * updates at booking time too. Callers filter with assertPickupPossible first.
 */
function applyPickup(block: MockBlock, roomType: string, arrival: string, departure: string): void {
  for (const date of stayDates(arrival, departure)) {
    const slot = block.roomTypeAllocations.find((a) => a.date === date && a.roomType === roomType);
    if (slot) slot.roomsPickedUp += 1;
  }
}

function seedRooms(): void {
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

function seedOutages(): void {
  if (roomOutages.size > 0) return;
  // Records why seeded room 1502 is out of order. A status with no dates leaves
  // nobody knowing when it can be sold again.
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

/** Does the outage touch the stay (arrival through the night before departure)? */
function outageOverlapsStay(outage: MockRoomOutage, arrival: string, departure: string): boolean {
  const lastNight = addDays(departure, -1);
  return outage.startDate <= lastNight && outage.endDate >= arrival;
}

/** Is the room out on that date? Start and end are both inclusive. */
function outageCoversDate(outage: MockRoomOutage, date: string): boolean {
  return outage.startDate <= date && outage.endDate >= date;
}

/** The balance is always the sum of postings, cut to two decimals. */
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
 * Finds the reservation's folio, opening window 1 when there is none.
 *
 * OPERA creates a folio with the reservation. Rather than seeding one for every
 * reservation, we open it on first use — the outside behaviour is the same.
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
function availableRooms(
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

/** Is the room sellable for that stay? An overlapping outage blocks assignment. */
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
 * Rejects codes that are not configured.
 *
 * Letting them through puts typos straight into the reports, where BOOKINGCOM
 * and BOOKING.COM become two channels. Channel performance stops being trusted.
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

/** Statuses that can become a no-show. A guest already in house did show up. */
const NO_SHOW_FROM = ['Reserved', 'Confirmed', 'Waitlisted'];

/** Statuses that can check in. A cancelled or no-show booking gets no room. */
const CHECK_IN_FROM = ['Reserved', 'Confirmed'];

/** OPERA allows up to eight folio windows per reservation. */
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

/**
 * Mock responses are always copies.
 *
 * Returning the stored object lets a caller mutate the store, and later changes
 * appear retroactively in responses already handed out. Real HTTP does not work
 * that way, so we cut the link here too.
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

  // --- Availability ------------------------------------------------------
  if (method === 'GET' && /\/availability$/.test(path)) {
    const arrival = String(query.startDate ?? dayOffset(0));
    const departure = String(query.endDate ?? dayOffset(1));
    const stayNights = nights(arrival, departure);

    // Quoting and accepting share one calculation. Split them and "sold out" still books.
    const roomTypes = query.roomType ? [String(query.roomType)] : Object.keys(RATES);
    const adults = Number(query.adults ?? 1);
    const sellable = sellablePlans(hotelId, arrival, departure);

    return {
      roomStays: roomTypes.map((code) => {
        // The quoted total uses the cheapest rate that can sell this room.
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

  // --- Rates ---------------------------------------------------------------
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
            // Nightly amounts alongside the total. OPERA returns period rates this way.
            nightlyRates: row.nightlyRates,
            packages: row.packages,
            total: { amount: row.totalAmount, currencyCode: row.currencyCode },
          })),
      );

    return { ratePlans: offers } as T;
  }

  // --- Transaction codes -----------------------------------------------------
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

  // --- Rate plan configuration -------------------------------------------------
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
        /*
         * No policy means free cancellation and no deposit.
         *
         * Inventing a penalty here charges the guest on terms nobody told them.
         * If the hotel wants one, it has to say so.
         */
        cancellationPolicy: readCancellationPolicy(body.cancellationPolicy),
        depositPolicy: readDepositPolicy(body.depositPolicy),
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

      if (body.cancellationPolicy !== undefined) {
        plan.cancellationPolicy = readCancellationPolicy(body.cancellationPolicy);
      }
      if (body.depositPolicy !== undefined) {
        plan.depositPolicy = readDepositPolicy(body.depositPolicy);
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

  // --- Housekeeping: room status ---------------------------------------------
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

    // Taking an occupied room out of service desyncs inventory from reality. OPERA blocks it too.
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

  // --- Room outages ------------------------------------------------------------
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

    // Blocking a past range does not bring back rooms already sold; it only skews reports.
    const today = businessDates.get(hotelId) ?? dayOffset(0);
    if (endDate < today) {
      throw new OperaApiError(
        400,
        { detail: 'PAST_PERIOD' },
        `이미 지난 기간(${startDate} ~ ${endDate})은 사용 불가로 등록할 수 없습니다.`,
      );
    }

    // Blocking the same room twice deducts it from inventory twice.
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

    // A guest already booked into this room for those dates has to move first.
    // Accepting the outage silently means finding out on arrival day.
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

    // Refuse if the room is occupied and the outage starts today. Future ranges are fine.
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

    // If the range covers today, change housekeeping status now. Future ones stay —
    // next week's maintenance does not stop us selling the room today.
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

    // Releasing puts the room back on sale. We cannot know whether it is clean, so
    // it returns to the status chosen at registration (usually Dirty). Forcing Clean
    // would show an uncleaned room as sellable.
    const room = rooms.get(outage.roomId);
    const today = businessDates.get(hotelId) ?? dayOffset(0);
    if (room && outageCoversDate(outage, today)) {
      rooms.set(outage.roomId, { ...room, roomStatus: outage.returnStatus });
    }

    return { ...outage, released: true } as T;
  }

  // --- Business date -------------------------------------------------------
  if (method === 'GET' && /\/lov\/v1\/hotels\/[^/]+\/businessDate$/.test(path)) {
    return {
      hotelId,
      businessDate: businessDates.get(hotelId) ?? dayOffset(0),
      currentDate: dayOffset(0),
    } as T;
  }

  // --- Profiles --------------------------------------------------------------
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

    // Move reservations onto the surviving profile. The source is not deleted —
    // deleting it would drop the guest from those reservations.
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

  // --- Group blocks ------------------------------------------------------------
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
      // A named rate plan must exist. Holding rooms on an unknown code leaves the
      // rooming list with no way to price a pickup.
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
      // The request carries counts per room type; spreading them by date is OPERA's job.
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

      // Cancelling a block with pickups removes the basis for those reservations.
      const pickedUp = existing.roomTypeAllocations.reduce((sum, a) => sum + a.roomsPickedUp, 0);
      if (nextStatus === 'Cancelled' && pickedUp > 0) {
        throw new OperaApiError(
          400,
          { detail: 'BLOCK_HAS_PICKUP' },
          '이미 픽업된 예약이 있는 블록은 취소할 수 없습니다.',
        );
      }

      /*
       * Adjusting the negotiated amount.
       *
       * Reservations already picked up keep their amount — that price is agreed
       * with that guest. Only future pickups take the new one.
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

  // --- Reservation list ----------------------------------------------------
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

  // --- Create reservation ----------------------------------------------------
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
     * Never oversell.
     *
     * The mock used to advise on availability but accept every booking. That let
     * a reservation through while the screen said sold out, which defeats the point
     * of leaving inventory to OPERA.
     *
     * Rather than turning the guest away when nothing is free, take a waitlist
     * booking. It holds no inventory and is confirmed when a room opens up.
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
     * Guarantee type.
     *
     * Defaults to 6PM — an unguaranteed booking is only held until 18:00.
     * Without that, a no-show is just an empty room.
     */
    const guaranteeCode = String(body.guaranteeCode ?? 'SIXPM').toUpperCase();
    assertCode(GUARANTEE_CODES, guaranteeCode, '보증 방식');

    /*
     * A supplied profile id is honoured as given.
     *
     * The mock store lives only as long as the process, so after a restart it does
     * not know profiles it issued before. Inventing a new id would attach the
     * reservation to a different profile and multiply profiles per repeat guest.
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
     * The rate engine sets the price.
     *
     * If quoting and charging use different maths, the amount the guest saw and
     * the amount on the folio diverge. Same quote(), and unsellable combinations
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
     * A pickup sells at the block's negotiated amount.
     *
     * Groups agree their own price. Charging rack rate leaves the agreement in the
     * contract while the guest pays something else. We sum the per-date amounts.
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
       * Booking on an existing profile keeps that profile's name.
       *
       * Overwriting it with the submitted name renames the guest because of one
       * reservation. The profile is the record of the person; reservations hang off it.
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
      guaranteeCode,
    };

    store.set(created.reservationId, created);
    rememberProfile(created.guest);
    if (block) applyPickup(block, roomType, arrival, departure);
    return created as T;
  }

  // --- Folios and postings ---------------------------------------------------
  const folioListMatch = /\/reservations\/([^/]+)\/folios$/.exec(path);
  if (folioListMatch && method === 'GET') {
    const reservationId = decodeURIComponent(folioListMatch[1] ?? '');
    assertReservationExists(reservationId);

    const list = reservationFolios(reservationId);
    // With none yet, open window 1 and return it. An empty array reads as "folio
    // closed" to the caller.
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
     * A reference posts only once.
     *
     * A POS resending after a dropped connection is common. Posting twice charges
     * the guest twice and is hard to undo. An existing one is returned as-is so
     * the caller sees success and stops retrying.
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

    // We post a reversing entry instead of deleting. Deleting makes the charge vanish
    // from the guest's statement with no way to explain what was corrected.
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

    // A void pair moves together. Moving one side skews both balances.
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
    // Window 1 always exists once a reservation does, same rule as posting.
    const folio = ensureFolio(hotelId, reservationId, window);

    // Closing a folio with a balance leaves revenue unrecorded.
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

  // --- Cancellation terms and deposits ---------------------------------------
  const policyMatch = /\/reservations\/([^/]+)\/policies$/.exec(path);
  if (policyMatch && method === 'GET') {
    const id = decodeURIComponent(policyMatch[1] ?? '');
    const reservation = store.get(id);
    if (!reservation) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }

    const plan = ratePlans.get(planKey(hotelId, reservation.roomStay.ratePlanCode ?? 'BAR'));
    const penalty = cancellationPenalty(reservation, plan, new Date());
    const deposit = depositRequired(reservation, plan);

    // Deposits taken are the folio's payment total. Counting separately splits the two.
    const paid = reservationFolios(reservation.reservationId)
      .flatMap((folio) => folio.postings)
      .filter((posting) => posting.type === 'Payment')
      .reduce((sum, posting) => sum - posting.amount, 0);

    return {
      reservationId: reservation.reservationId,
      guaranteeCode: reservation.guaranteeCode ?? 'SIXPM',
      currencyCode: reservation.roomStay.total?.currencyCode ?? 'KRW',
      cancellation: {
        policyName: penalty.policyName,
        freeUntil: penalty.freeUntil,
        withinFreeWindow: penalty.withinFreeWindow,
        penaltyAmount: penalty.amount,
      },
      deposit: {
        requiredAmount: deposit.amount,
        ...(deposit.dueDate ? { dueDate: deposit.dueDate } : {}),
        paidAmount: paid,
      },
    } as T;
  }

  const guaranteeMatch = /\/reservations\/([^/]+)\/guarantee$/.exec(path);
  if (guaranteeMatch && (method === 'PUT' || method === 'PATCH')) {
    const id = decodeURIComponent(guaranteeMatch[1] ?? '');
    const reservation = store.get(id);
    if (!reservation) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }
    if (['Cancelled', 'CheckedOut', 'NoShow'].includes(reservation.reservationStatus)) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_STATUS' },
        `현재 상태(${reservation.reservationStatus})의 예약은 보증 방식을 바꿀 수 없습니다.`,
      );
    }

    const guaranteeCode = String(body.guaranteeCode ?? '').toUpperCase();
    assertCode(GUARANTEE_CODES, guaranteeCode, '보증 방식');

    const updated: MockReservation = { ...reservation, guaranteeCode };
    store.set(id, updated);
    return updated as T;
  }

  const depositMatch = /\/reservations\/([^/]+)\/deposit$/.exec(path);
  if (depositMatch && method === 'POST') {
    const id = decodeURIComponent(depositMatch[1] ?? '');
    const reservation = store.get(id);
    if (!reservation) {
      throw new OperaApiError(404, { detail: 'NOT_FOUND' }, `예약을 찾을 수 없습니다: ${id}`);
    }
    if (['Cancelled', 'NoShow'].includes(reservation.reservationStatus)) {
      throw new OperaApiError(
        400,
        { detail: 'INVALID_STATUS' },
        `현재 상태(${reservation.reservationStatus})의 예약에는 보증금을 받을 수 없습니다.`,
      );
    }

    const amount = Number(body.amount ?? 0);
    if (!(amount > 0)) {
      throw new OperaApiError(400, { detail: 'INVALID_AMOUNT' }, '보증금은 0보다 커야 합니다.');
    }

    /*
     * A deposit posts to the folio as a payment.
     *
     * There is no charge yet, but we already hold the money. Keeping it elsewhere
     * makes the guest pay twice at check-in, or leaves change we cannot return.
     */
    const folio = ensureFolio(hotelId, reservation.reservationId, 1);
    const reference = body.reference ? String(body.reference) : undefined;
    if (reference && folio.postings.some((posting) => posting.reference === reference)) {
      throw new OperaApiError(
        409,
        { detail: 'DUPLICATE_REFERENCE' },
        `이미 처리한 보증금입니다: ${reference}`,
      );
    }

    folio.postings.push({
      postingId: `PST-${(postingSequence += 1)}`,
      type: 'Payment',
      transactionCode: String(body.transactionCode ?? DEPOSIT_CODE),
      description: String(body.description ?? '보증금'),
      amount: -amount,
      currencyCode: folio.currencyCode,
      postedAt: new Date().toISOString(),
      ...(reference ? { reference } : {}),
    });

    return toFolioPayload(folio) as T;
  }

  // --- Room share ------------------------------------------------------------
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

    // Without overlapping dates they cannot share a room.
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

    // With different room types there is no way to decide which room to give.
    if (first.roomStay.roomType !== second.roomStay.roomType) {
      throw new OperaApiError(
        400,
        { detail: 'ROOM_TYPE_MISMATCH' },
        `객실 타입이 다릅니다: ${first.roomStay.roomType} / ${second.roomStay.roomType}`,
      );
    }

    /*
     * If one already has a room, match it.
     *
     * When both sit in different rooms we cannot decide which to move. Release one
     * assignment first and ask again.
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
     * Clear the group on a reservation left alone.
     *
     * Leaving the marker on a reservation that shares with nobody makes it unclear
     * which group a later reservation would join.
     */
    const remaining = [...store.values()].filter((r) => r.roomStay.shareGroupId === groupId);
    if (remaining.length === 1) {
      const only = remaining[0]!;
      store.set(only.reservationId, { ...only, roomStay: dropShare(only.roomStay) });
    }

    return store.get(id) as T;
  }

  // --- Waitlist confirmation ---------------------------------------------------
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
     * Availability is re-checked at confirmation.
     *
     * That nothing was free when it was waitlisted says nothing about now. Only a
     * fresh count answers it, and another waitlist entry may have taken the room.
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

  // --- Check-in / check-out ----------------------------------------------------
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
    // Checking in before the arrival date leaves that night's inventory unsold.
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
     * A room with another guest in it cannot take a second one.
     *
     * Reservations that agreed to share are the exception: two guests, one room,
     * separate folios — that is what a share is.
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

    // A departed room is vacant and needs cleaning. Marking it clean sells an uncleaned room.
    const roomId = existing.roomStay.roomId;
    const room = roomId ? rooms.get(roomId) : undefined;
    if (roomId && room) rooms.set(roomId, { ...room, occupied: false, roomStatus: 'Dirty' });

    return updated as T;
  }

  // --- Reservation read / update / cancel ------------------------------------
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

      // Assigning a room requires it to be sellable for those dates. Putting a guest
      // in a room under maintenance surfaces on arrival day.
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
       * An edit reprices.
       *
       * Changing dates or room type changes the price. Keeping the old total
       * charges two nights when the guest extended to three.
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
      if (existing.reservationStatus === 'Cancelled') {
        throw new OperaApiError(400, { detail: 'ALREADY_CANCELLED' }, '이미 취소된 예약입니다.');
      }

      /*
       * Cancellation penalty.
       *
       * Past the free window, charge per policy. Without a folio posting there is
       * nothing to collect against, even on a card-guaranteed booking.
       */
      const plan = ratePlans.get(planKey(hotelId, existing.roomStay.ratePlanCode ?? 'BAR'));
      const penalty = cancellationPenalty(existing, plan, new Date());

      if (penalty.amount > 0) {
        const folio = ensureFolio(hotelId, existing.reservationId, 1);
        folio.postings.push({
          postingId: `PST-${(postingSequence += 1)}`,
          type: 'Charge',
          transactionCode: CANCELLATION_FEE_CODE,
          description: `취소 위약금 (${penalty.policyName})`,
          amount: penalty.amount,
          currencyCode: folio.currencyCode,
          postedAt: new Date().toISOString(),
        });
      }

      const cancelled: MockReservation = {
        ...existing,
        reservationStatus: 'Cancelled',
        cancellationPenalty: penalty.amount,
      };
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
  sequence = SEQUENCE_START;
  blockSequence = BLOCK_SEQUENCE_START;
  outageSequence = OUTAGE_SEQUENCE_START;
  shareSequence = SHARE_SEQUENCE_START;
  folioSequence = FOLIO_SEQUENCE_START;
  postingSequence = FOLIO_SEQUENCE_START;
}
