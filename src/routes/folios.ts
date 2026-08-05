import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { env } from '../config/env.js';
import { operaRequest } from '../opera/client.js';
import { ErrorResponse } from '../schemas/common.js';
import {
  CloseFolioBody,
  CreatePostingBody,
  Folio,
  FolioListResponse,
  FolioParams,
  FolioWindowParams,
  OpenFolioBody,
  PostingParams,
  TransferPostingBody,
  VoidPostingBody,
} from '../schemas/folio.js';
import { DepositBody } from '../schemas/reservation.js';

/**
 * Folio — the guest's bill.
 *
 * OPERA owns the ledger. If both systems computed balances they would diverge,
 * and there would be no basis for deciding which is right. So every path that
 * creates a posting — front desk, POS, payments — goes through here.
 *
 * We never add up balances ourselves; we use what OPERA returns.
 *
 * Paths follow OHIP cashiering conventions but are a guess (`/csh/v1/...`). When
 * the spec arrives, only this file and the mock transport need fixing.
 */
export const folioRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/reservations/:reservationId/folios',
    {
      schema: {
        tags: ['folios'],
        summary: 'Folios and postings for a reservation',
        params: FolioParams,
        response: { 200: FolioListResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaFolioListPayload>(
        folioPath(hotel, request.params.reservationId),
        {
          hotelId: hotel,
        },
      );

      return {
        reservationId: request.params.reservationId,
        folios: (raw.folios ?? []).map(toFolio),
      };
    },
  );

  app.post(
    '/v1/reservations/:reservationId/folios',
    {
      schema: {
        tags: ['folios'],
        summary: 'Open a folio window, for a split settlement',
        params: FolioParams,
        body: OpenFolioBody,
        response: {
          201: Folio,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;
      const raw = await operaRequest<OperaFolioPayload>(
        folioPath(hotel, request.params.reservationId),
        {
          method: 'POST',
          hotelId: hotel,
          body: request.body.window === undefined ? {} : { window: request.body.window },
        },
      );

      return reply.code(201).send(toFolio(raw));
    },
  );

  /**
   * Taking a deposit.
   *
   * There is no charge before arrival, but we already hold the money. Without a
   * folio payment the guest pays twice at check-in, or we cannot return change.
   */
  app.post(
    '/v1/reservations/:reservationId/deposit',
    {
      schema: {
        tags: ['folios'],
        summary: 'Take a deposit — posted to the folio as a payment',
        params: FolioParams,
        body: DepositBody,
        response: {
          201: Folio,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaFolioPayload>(
        `/rsv/v1/hotels/${hotel}/reservations/${encodeURIComponent(
          request.params.reservationId,
        )}/deposit`,
        { method: 'POST', hotelId: hotel, body: rest },
      );

      return reply.code(201).send(toFolio(raw));
    },
  );

  app.post(
    '/v1/reservations/:reservationId/folios/:window/postings',
    {
      schema: {
        tags: ['folios'],
        summary: 'Post a transaction — OPERA computes the balance',
        params: FolioWindowParams,
        body: CreatePostingBody,
        response: { 200: Folio, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const { hotelId, ...posting } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaFolioPayload>(
        `${folioPath(hotel, request.params.reservationId)}/${request.params.window}/postings`,
        { method: 'POST', hotelId: hotel, body: posting },
      );

      return toFolio(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/folios/postings/:postingId/void',
    {
      schema: {
        tags: ['folios'],
        summary: 'Void a posting — the original is kept and an opposite adjustment added',
        params: PostingParams,
        body: VoidPostingBody,
        response: {
          200: Folio,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { hotelId, ...rest } = request.body;
      const hotel = hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaFolioPayload>(
        `${folioPath(hotel, request.params.reservationId)}/postings/${encodeURIComponent(request.params.postingId)}/void`,
        { method: 'POST', hotelId: hotel, body: rest },
      );

      return toFolio(raw);
    },
  );

  app.post(
    '/v1/reservations/:reservationId/folios/postings/:postingId/transfer',
    {
      schema: {
        tags: ['folios'],
        summary: 'Transfer a posting to another window',
        params: PostingParams,
        body: TransferPostingBody,
        response: {
          200: FolioListResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaFolioListPayload>(
        `${folioPath(hotel, request.params.reservationId)}/postings/${encodeURIComponent(request.params.postingId)}/transfer`,
        { method: 'POST', hotelId: hotel, body: { toWindow: request.body.toWindow } },
      );

      return {
        reservationId: request.params.reservationId,
        folios: (raw.folios ?? []).map(toFolio),
      };
    },
  );

  app.post(
    '/v1/reservations/:reservationId/folios/:window/close',
    {
      schema: {
        tags: ['folios'],
        summary: 'Close a folio — the balance must be zero',
        params: FolioWindowParams,
        body: CloseFolioBody,
        response: { 200: Folio, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
      },
    },
    async (request) => {
      const hotel = request.body.hotelId ?? env.ohip.defaultHotelId;

      const raw = await operaRequest<OperaFolioPayload>(
        `${folioPath(hotel, request.params.reservationId)}/${request.params.window}/close`,
        { method: 'POST', hotelId: hotel, body: {} },
      );

      return toFolio(raw);
    },
  );
};

function folioPath(hotelId: string, reservationId: string): string {
  return `/csh/v1/hotels/${hotelId}/reservations/${encodeURIComponent(reservationId)}/folios`;
}

function toFolio(raw: OperaFolioPayload) {
  return {
    folioId: raw.folioId ?? '',
    reservationId: raw.reservationId ?? '',
    window: raw.window ?? 1,
    status: (raw.status ?? 'Open') as Folio['status'],
    balance: raw.balance ?? 0,
    currencyCode: raw.currencyCode ?? 'KRW',
    postings: (raw.postings ?? []).map((posting) => ({
      postingId: posting.postingId ?? '',
      type: (posting.type ?? 'Charge') as Folio['postings'][number]['type'],
      transactionCode: posting.transactionCode ?? '',
      description: posting.description ?? '',
      amount: posting.amount ?? 0,
      currencyCode: posting.currencyCode ?? raw.currencyCode ?? 'KRW',
      postedAt: posting.postedAt ?? '',
      ...(posting.reference ? { reference: posting.reference } : {}),
      ...(posting.voidedById ? { voidedById: posting.voidedById } : {}),
      ...(posting.transferredFromWindow === undefined
        ? {}
        : { transferredFromWindow: posting.transferredFromWindow }),
    })),
  };
}

/** Declares only the parts of the OHIP response we actually use. */
interface OperaPostingPayload {
  postingId?: string;
  type?: string;
  transactionCode?: string;
  description?: string;
  amount?: number;
  currencyCode?: string;
  postedAt?: string;
  reference?: string;
  voidedById?: string;
  transferredFromWindow?: number;
}

interface OperaFolioPayload {
  folioId?: string;
  reservationId?: string;
  window?: number;
  status?: string;
  balance?: number;
  currencyCode?: string;
  postings?: OperaPostingPayload[];
}

interface OperaFolioListPayload {
  folios?: OperaFolioPayload[];
}
