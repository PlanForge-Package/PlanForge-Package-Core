import { env } from '../config/env.js';
import type { Block } from '../schemas/block.js';

/**
 * Declares only the parts of the OHIP block response we actually use.
 *
 * Field names follow common OHIP conventions but are a guess. When the real spec
 * arrives, fix this file and mock-transport together; nothing else needs to change.
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
    // Totals are computed once here so each screen does not re-sum them.
    totalBlocked: allotments.reduce((sum, slot) => sum + slot.blocked, 0),
    totalPickedUp: allotments.reduce((sum, slot) => sum + slot.pickedUp, 0),
  };
}
