<div align="center">

# PlanForge Core

**Oracle OPERA Cloud (OHIP) integration gateway**

The API server for PlanForge, a hotel management platform. It owns OPERA authentication, token
caching, response normalisation and error translation.

[한국어](README.md) · **English** · [中文](README.zh.md) · [日本語](README.ja.md)

![TypeScript](https://img.shields.io/badge/TypeScript-87.8%25-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Markdown](https://img.shields.io/badge/Markdown-3.6%25-083FA1?style=flat-square)
![YAML](https://img.shields.io/badge/YAML-2.9%25-CB171E?style=flat-square)
![JSON](https://img.shields.io/badge/JSON-2.1%25-000000?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-0.9%25-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## Background

**OPERA is the system of record** for reservations, inventory and rates. If PlanForge computed
availability, priced stays or issued confirmation numbers on its own, the two systems would
eventually disagree — and there would be no basis for deciding which one is right. For accounting
data that is fatal.

Core is therefore a **thin delegation layer**. It reshapes requests, hands them to OPERA, and
returns what comes back. Only a handful of mapper files know OHIP field names; when the real
subscription spec arrives, those files are the only ones that need to change.

Core is **never exposed publicly.** It holds the OHIP client secret and the OPERA integration
account, so only BE may reach it, from inside the network.

### Platform

| Repository | Role |
| --- | --- |
| [PlanForge-Package-FE](https://github.com/PlanForge-Package/PlanForge-Package-FE) | Operator / front-desk web UI |
| [PlanForge-Package-BE](https://github.com/PlanForge-Package/PlanForge-Package-BE) | Business logic · own database |
| **PlanForge-Package-Core** | **Oracle OPERA (OHIP) integration API server** |

Call path: `FE → BE → Core → OPERA Cloud (OHIP)`

---

## Language & stack

| Area | Technology |
| --- | --- |
| Language | TypeScript 5.9 (strict) |
| Runtime | Node.js 20.11+ |
| Web framework | Fastify 5 |
| Schema & validation | TypeBox — runtime validation and OpenAPI generated from one definition |
| API docs | `@fastify/swagger` · Swagger UI (`/docs`) |
| Security | `@fastify/helmet` · `@fastify/cors` · `@fastify/rate-limit` |
| Logging | Pino (auth headers redacted automatically) |
| Tests | Vitest — 58 cases |
| Quality | ESLint · Prettier · GitHub Actions |
| Deployment | Docker (multi-stage · non-root · HEALTHCHECK) |
| Package manager | pnpm 9 |

---

## Directory structure

```
src/
├── config/
│   └── env.ts                    Environment loading · production guards
├── opera/
│   ├── token-store.ts            OHIP OAuth2 token cache (coalesced refresh, invalidate on 401)
│   ├── client.ts                 OHIP REST wrapper (one retry on 401)
│   ├── mock-transport.ts         Mock transport used when OHIP_MODE=mock
│   ├── reservation-mapper.ts     Reservation OPERA ↔ PlanForge mapping
│   ├── block-mapper.ts           Group block mapping
│   └── errors.ts                 OperaApiError · OperaAuthError
├── plugins/
│   └── auth.ts                   Internal service API key (x-api-key)
├── routes/
│   ├── availability.ts           Room availability for a date range
│   ├── rates.ts                  Rates for a date range
│   ├── reservations.ts           Read · create · amend · cancel · no-show
│   ├── blocks.ts                 Group blocks · rooming list
│   ├── profiles.ts               Guest profiles · duplicate merge
│   ├── housekeeping.ts           Room status
│   ├── night-audit.ts            Business date
│   └── health.ts                 Health check (unauthenticated)
├── schemas/                      TypeBox request / response schemas
├── scripts/
│   └── export-openapi.ts         OpenAPI document export
└── server.ts
```

---

## Getting started

### Requirements

- Node.js 20.11+
- pnpm 9

### Install and run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| URL | Purpose |
| --- | --- |
| `http://localhost:3002` | API |
| `http://localhost:3002/docs` | Swagger UI |
| `http://localhost:3002/health` | Health check (unauthenticated) |

### Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Development server (watch) |
| `pnpm build` / `pnpm start` | Build / production run |
| `pnpm test` | Vitest |
| `pnpm openapi:export` | Generate `openapi/planforge-core.json` |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Quality checks |

### Environment variables

| Name | Description |
| --- | --- |
| `PORT` | Server port (default `3002`) |
| `SERVICE_API_KEY` | Internal caller key. Empty disables auth for local development |
| `CORS_ORIGIN` | Allowed origins (comma separated) |
| `OHIP_MODE` | `mock` \| `live` — defaults to `mock` |
| `OHIP_BASE_URL` | OHIP gateway URL |
| `OHIP_APP_KEY` | OHIP application key (`x-app-key`) |
| `OHIP_CLIENT_ID` / `OHIP_CLIENT_SECRET` | OAuth2 client credentials |
| `OHIP_USERNAME` / `OHIP_PASSWORD` | OPERA Cloud integration user |
| `OHIP_HOTEL_ID` | Default hotel code |

Starting with `NODE_ENV=production` **fails immediately** if any of the above is missing or if
`OHIP_MODE` is not `live`. A mock instance in production would let fake reservations circulate as
if they were real.

### Mock mode (`OHIP_MODE=mock`)

Only the transport layer changes. Response mapping runs exactly as it does in live mode, so moving
to a real integration touches `mock-transport.ts` and nothing else. The whole stack — FE and BE
included — can be developed and verified without subscription specs or credentials.

The mock store lives **only for the process lifetime.** Restarting Core forgets the reservations,
profiles and blocks it issued, while BE's database keeps them, so the two can drift apart. Run
`pnpm prisma:seed` in BE to realign them.

---

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Service status |
| `GET` | `/v1/availability` | Room availability for a date range |
| `GET` | `/v1/rates` | Rates for a date range |
| `GET` `POST` | `/v1/rate-plans` | Rate plans · create |
| `GET` `PATCH` | `/v1/rate-plans/:ratePlanCode` | One rate plan · update |
| `POST` | `/v1/rate-plans/:ratePlanCode/seasons` | Add a season (dates · days of week) |
| `DELETE` | `/v1/rate-plans/:ratePlanCode/seasons/:seasonId` | Remove a season |
| `GET` `POST` | `/v1/packages` | Packages · create |
| `PATCH` | `/v1/packages/:packageCode` | Update a package |
| `GET` `POST` | `/v1/transaction-codes` | Transaction codes · create (revenue group, tax) |
| `PATCH` | `/v1/transaction-codes/:transactionCode` | Update a transaction code |
| `GET` | `/v1/reservations` | Reservation list |
| `GET` | `/v1/reservations/:reservationId` | Single reservation |
| `POST` | `/v1/reservations` | Create reservation |
| `PATCH` | `/v1/reservations/:reservationId` | Amend reservation |
| `POST` | `/v1/reservations/:reservationId/cancel` | Cancel reservation |
| `POST` | `/v1/reservations/:reservationId/no-show` | Mark no-show |
| `POST` | `/v1/reservations/:reservationId/check-in` | Check in (with room assignment) |
| `POST` | `/v1/reservations/:reservationId/check-out` | Check out |
| `POST` | `/v1/reservations/:reservationId/confirm-waitlist` | Confirm a waitlisted booking |
| `POST` | `/v1/reservations/:reservationId/share` | Share a room between two bookings |
| `POST` | `/v1/reservations/:reservationId/unshare` | Leave the share group |
| `GET` `POST` | `/v1/reservations/:id/folios` | Read folios · open a window |
| `POST` | `/v1/reservations/:id/folios/:window/postings` | Post a transaction |
| `POST` | `/v1/reservations/:id/folios/postings/:postingId/void` | Void a transaction |
| `POST` | `/v1/reservations/:id/folios/postings/:postingId/transfer` | Move between windows |
| `POST` | `/v1/reservations/:id/folios/:window/close` | Close a folio |
| `GET` | `/v1/reservations/:id/policies` | Cancellation terms and deposit — what it costs to cancel now |
| `PUT` | `/v1/reservations/:id/guarantee` | Change the guarantee type |
| `POST` | `/v1/reservations/:id/deposit` | Take a deposit — posted to the folio as a payment |
| `GET` | `/v1/blocks` | Group block list |
| `GET` | `/v1/blocks/:blockId` | Single block — allotment by date and room type |
| `GET` | `/v1/blocks/:blockId/reservations` | Rooming list |
| `POST` | `/v1/blocks` | Create block |
| `PATCH` | `/v1/blocks/:blockId` | Amend block |
| `GET` | `/v1/profiles/:profileId` | Single guest profile |
| `POST` | `/v1/profiles/:profileId/merge` | Merge duplicate profiles |
| `GET` | `/v1/housekeeping/rooms` | Room status |
| `PUT` | `/v1/housekeeping/rooms/:roomNumber/status` | Change room status |
| `GET` | `/v1/housekeeping/outages` | Out-of-order / out-of-service rooms |
| `POST` | `/v1/housekeeping/outages` | Take a room out of inventory |
| `DELETE` | `/v1/housekeeping/outages/:outageId` | Put the room back on sale |
| `GET` | `/v1/business-date` | Hotel business date |

### Design decisions

**Error translation** — Rejections a caller can act on (400 · 404 · 409 · 422) pass through with
their status and message intact. Flattening everything to 502 would make an input error such as
"departure must be after arrival" look like a gateway outage, and FE would retry a request that can
never succeed. 401 and 403 are hidden behind 502 because they are our credential problems, not the
caller's.

**Source of business** — Kept as three axes (`sourceCode` · `marketCode` · `channelCode`), as OPERA
does. Codes outside the configured set are rejected: letting typos through means `BOOKINGCOM` and
`BOOKING.COM` become different channels, and channel performance stops being trustworthy from that
moment on.

**Business date** — Not the same as the calendar date. Until the night audit runs, yesterday remains
the business date even past midnight, and that value decides which day revenue and occupancy land
on. Only OPERA knows when the audit ran, so we read the value instead of computing it.

---

## Deployment

```bash
docker build -t planforge-core .
```

Multi-stage, runs as non-root (`node`), and ships a HEALTHCHECK against `/health`. For the full
stack see `deploy/docker-compose.yml` in the BE repository. Images publish to GHCR on tag pushes
only.

> **⚠️ Known limitation** — OHIP response shapes are **estimates** based on common conventions. When
> the real subscription spec arrives, `mock-transport.ts` and the mapper files must be updated
> together.

---

## Licence

UNLICENSED — internal use only.
