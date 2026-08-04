import { describe, expect, it } from 'vitest';
import { toOperaRoomStay, toReservation } from './reservation-mapper.js';

describe('toReservation', () => {
  it('OPERA 응답을 PlanForge 형태로 옮긴다', () => {
    const result = toReservation({
      reservationId: 'OPERA-1001',
      confirmationNumber: 'OP1001',
      hotelId: 'SAND01',
      reservationStatus: 'InHouse',
      roomStay: {
        arrivalDate: '2026-08-03',
        departureDate: '2026-08-05',
        roomType: 'DLXK',
        ratePlanCode: 'BAR',
        roomId: '1203',
        adultCount: 2,
        childCount: 1,
        total: { amount: 480000, currencyCode: 'KRW' },
      },
      guest: { profileId: 'PRF-1', givenName: 'Minsu', surname: 'Kim', email: 'a@b.c' },
    });

    expect(result).toMatchObject({
      reservationId: 'OPERA-1001',
      status: 'InHouse',
      roomNumber: '1203',
      totalAmount: 480000,
      currency: 'KRW',
      guest: { firstName: 'Minsu', lastName: 'Kim' },
    });
  });

  // OPERA sometimes returns the reservation id as a list rather than a single field.
  it('reservationIdList 가 있으면 그쪽을 우선한다', () => {
    const result = toReservation({
      reservationId: 'IGNORED',
      reservationIdList: [{ id: 'OPERA-2002', type: 'Reservation' }],
      roomStay: { arrivalDate: '2026-08-03', departureDate: '2026-08-04' },
    });
    expect(result.reservationId).toBe('OPERA-2002');
  });

  it('필드가 비어도 형태를 유지한다', () => {
    const result = toReservation({});
    expect(result.reservationId).toBe('');
    expect(result.status).toBe('Reserved');
    expect(result.guest).toBeUndefined();
  });
});

describe('toOperaRoomStay', () => {
  it('PlanForge 이름을 OPERA 이름으로 바꾼다', () => {
    expect(
      toOperaRoomStay({
        arrivalDate: '2026-08-03',
        departureDate: '2026-08-05',
        roomTypeCode: 'DLXK',
        ratePlanCode: 'BAR',
        adults: 2,
        children: 1,
      }),
    ).toEqual({
      arrivalDate: '2026-08-03',
      departureDate: '2026-08-05',
      roomType: 'DLXK',
      ratePlanCode: 'BAR',
      adultCount: 2,
      childCount: 1,
    });
  });

  // Sending fields a partial update did not include makes OPERA overwrite them.
  it('주지 않은 값은 아예 넣지 않는다', () => {
    expect(toOperaRoomStay({ roomTypeCode: 'SUIT' })).toEqual({ roomType: 'SUIT' });
  });

  it('0 은 값으로 취급한다', () => {
    expect(toOperaRoomStay({ children: 0 })).toEqual({ childCount: 0 });
  });
});
