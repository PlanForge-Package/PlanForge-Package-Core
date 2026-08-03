import { env } from '../config/env.js';
import type { Block } from '../schemas/block.js';

/**
 * OHIP 블록 응답에서 실제로 쓰는 부분만 좁게 선언한다.
 *
 * 필드 이름은 일반적인 OHIP 규약을 따른 **추정치**다. 실제 구독 스펙을 받으면
 * 이 파일과 mock-transport 를 함께 맞추면 되고 나머지 코드는 손대지 않아도 된다.
 */
export interface OperaBlockPayload {
  blockId?: string;
  blockIdList?: Array<{ id?: string; type?: string }>;
  blockCode?: string;
  blockName?: string;
  hotelId?: string;
  blockStatus?: string;
  startDate?: string;
  endDate?: string;
  cutoffDate?: string;
  currencyCode?: string;
  roomTypeAllocations?: Array<{
    date?: string;
    roomType?: string;
    roomsBlocked?: number;
    roomsPickedUp?: number;
    ratePlanCode?: string;
    amount?: number;
  }>;
}

export interface OperaBlockListPayload {
  blocks?: OperaBlockPayload[];
  totalResults?: number;
}

export function toBlock(raw: OperaBlockPayload): Block {
  const allotments = (raw.roomTypeAllocations ?? []).map((slot) => ({
    date: slot.date ?? '',
    roomTypeCode: slot.roomType ?? '',
    blocked: slot.roomsBlocked ?? 0,
    pickedUp: slot.roomsPickedUp ?? 0,
    ratePlanCode: slot.ratePlanCode,
    amount: slot.amount,
  }));

  return {
    blockId: raw.blockIdList?.[0]?.id ?? raw.blockId ?? '',
    code: raw.blockCode ?? '',
    name: raw.blockName ?? '',
    hotelId: raw.hotelId ?? env.ohip.defaultHotelId,
    status: (raw.blockStatus ?? 'Tentative') as Block['status'],
    startDate: raw.startDate ?? '',
    endDate: raw.endDate ?? '',
    cutoffDate: raw.cutoffDate,
    currency: raw.currencyCode,
    allotments,
    // 합계는 화면마다 다시 세지 않도록 여기서 한 번만 계산한다.
    totalBlocked: allotments.reduce((sum, slot) => sum + slot.blocked, 0),
    totalPickedUp: allotments.reduce((sum, slot) => sum + slot.pickedUp, 0),
  };
}
