import { OperaApiError } from './errors.js';
import type { OperaRequestOptions } from './client.js';
import {
  CANCELLATION_FEE_CODE,
  CHANNEL_CODES,
  CHECK_IN_FROM,
  DEPOSIT_CODE,
  GUARANTEE_CODES,
  MARKET_CODES,
  MAX_FOLIO_WINDOW,
  MockBlock,
  MockFolio,
  MockPackage,
  MockProfile,
  MockRatePlan,
  MockRateSeason,
  MockReservation,
  MockRoomOutage,
  MockTransactionCode,
  Quote,
  RATES,
  ROOM_STATUSES,
  ROOM_TYPE_NAMES,
  SOURCE_CODES,
  addDays,
  applyPickup,
  assertCode,
  assertNoSeasonConflict,
  assertNoShowAllowed,
  assertPickupPossible,
  assertReservationExists,
  assertRoomAssignable,
  availableRooms,
  blockAmount,
  blocks,
  businessDates,
  cancellationPenalty,
  counters,
  dayOffset,
  depositRequired,
  dropShare,
  ensureFolio,
  findPosting,
  folioBalance,
  folios,
  nights,
  outageCoversDate,
  packages,
  planKey,
  profiles,
  quote,
  ratePlans,
  readCancellationPolicy,
  readDepositPolicy,
  rememberProfile,
  requirePlan,
  reservationFolios,
  roomOutages,
  rooms,
  seed,
  seedBlocks,
  seedOutages,
  seedRates,
  seedRooms,
  seedTransactionCodes,
  sellablePlans,
  signedAmount,
  stayDates,
  store,
  toFolioPayload,
  transactionCodes,
} from './mock-store.js';

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
export { resetMockStore } from './mock-store.js';

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

    counters.season += 1;
    const season: MockRateSeason = {
      seasonId: `SEA-${counters.season}`,
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

    const outageId = `OOO-${(counters.outage += 1)}`;
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

    counters.block += 1;
    const created: MockBlock = {
      blockId: `BLK-${counters.block}`,
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

    counters.reservation += 1;
    const created: MockReservation = {
      reservationId: `OPERA-${counters.reservation}`,
      confirmationNumber: `OP${counters.reservation}`,
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
            profileId: requestedProfileId ?? `PRF-${counters.reservation}`,
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

    const folioId = `FOL-${(counters.folio += 1)}`;
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

    const postingId = `PST-${(counters.posting += 1)}`;
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
    const reversalId = `PST-${(counters.posting += 1)}`;
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
      postingId: `PST-${(counters.posting += 1)}`,
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
      first.roomStay.shareGroupId ?? second.roomStay.shareGroupId ?? `SHR-${(counters.share += 1)}`;

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
          postingId: `PST-${(counters.posting += 1)}`,
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
