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
 * 폴리오 — 손님의 계산서.
 *
 * 회계 원장은 OPERA 가 원천이다. 잔액을 두 시스템이 각자 계산하면 언젠가
 * 갈리고, 그때 어느 쪽이 맞는지 판단할 근거가 없다. 그래서 거래를 만드는 모든
 * 경로(프런트·외부 POS·결제)가 여기를 지난다.
 *
 * 잔액은 우리가 더하지 않는다. OPERA 가 돌려준 값을 그대로 쓴다.
 *
 * 경로는 OHIP 의 캐셔링 모듈 규약을 따른 **추정치**다(`/csh/v1/...`). 구독
 * 스펙을 받으면 이 파일과 모의 전송 계층만 맞추면 된다.
 */
export const folioRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/v1/reservations/:reservationId/folios',
    {
      schema: {
        tags: ['folios'],
        summary: '예약의 폴리오와 거래 내역',
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
        summary: '폴리오 윈도 개설 — 분할 정산',
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
   * 보증금 수납.
   *
   * 도착 전이라 청구는 없지만 그 돈은 이미 우리에게 있다. 폴리오에 결제로 올려
   * 두지 않으면 체크인 때 손님이 두 번 내거나, 남은 돈을 돌려주지 못한다.
   */
  app.post(
    '/v1/reservations/:reservationId/deposit',
    {
      schema: {
        tags: ['folios'],
        summary: '보증금 수납 — 폴리오에 결제로 올립니다',
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
        summary: '거래 등록 — 잔액은 OPERA 가 계산합니다',
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
        summary: '거래 취소 — 원본을 지우지 않고 반대 조정을 답니다',
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
        summary: '거래를 다른 창구로 이관',
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
        summary: '폴리오 마감 — 잔액이 0 이어야 합니다',
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

/** OHIP 응답에서 실제로 쓰는 부분만 좁게 선언한다. */
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
