# PlanForge-Package-Core

Oracle OPERA(OHIP) 기반 호텔 관리 플랫폼 **PlanForge** 의 **Core API Server** 입니다.
Oracle Hospitality Integration Platform 과의 연동을 전담하는 게이트웨이로,
인증·토큰 캐시·응답 정규화·오류 변환을 담당합니다.

## 플랫폼 구성

| 리포지토리 | 역할 | 스택 |
| --- | --- | --- |
| [PlanForge-Package-FE](https://github.com/PlanForge-Package/PlanForge-Package-FE) | 운영자·프론트데스크 웹 UI | Next.js 15 · TypeScript · Tailwind CSS 4 |
| [PlanForge-Package-BE](https://github.com/PlanForge-Package/PlanForge-Package-BE) | 업무 로직 · 자체 데이터베이스 | NestJS · Prisma · PostgreSQL |
| [PlanForge-Package-Core](https://github.com/PlanForge-Package/PlanForge-Package-Core) | Oracle OPERA(OHIP) 연동 API 서버 | Fastify · OpenAPI |

호출 경로: `FE → BE → Core → OPERA Cloud (OHIP)`

Core 는 외부에 직접 노출하지 않고 BE 만 호출하는 것을 전제로 합니다.
호출자는 `x-api-key` 헤더에 `SERVICE_API_KEY` 를 실어야 합니다.

## 요구 사항

- Node.js 20.11 이상
- pnpm 9
- OHIP 애플리케이션 키 및 OPERA Cloud 통합 계정

## 시작하기

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- API: `http://localhost:3002`
- Swagger UI: `http://localhost:3002/docs`
- 헬스체크: `GET http://localhost:3002/health` (인증 불필요)

## 제공 엔드포인트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 서비스 상태 |
| `GET` | `/v1/availability` | 기간별 객실 가용 현황 |
| `GET` | `/v1/rates` | 기간 요금 |
| `GET` | `/v1/reservations` | 예약 목록 |
| `GET` | `/v1/reservations/:reservationId` | 예약 단건 |
| `POST` | `/v1/reservations` | 예약 생성 |
| `PATCH` | `/v1/reservations/:reservationId` | 예약 수정 |
| `POST` | `/v1/reservations/:reservationId/cancel` | 예약 취소 |
| `GET` | `/v1/blocks` | 단체 블록 목록 |
| `GET` | `/v1/blocks/:blockId` | 블록 단건 — 일자·객실 타입별 할당 |
| `GET` | `/v1/blocks/:blockId/reservations` | 룸리스트 |
| `POST` | `/v1/blocks` | 블록 생성 |
| `PATCH` | `/v1/blocks/:blockId` | 블록 수정 |
| `POST` | `/v1/reservations/:reservationId/no-show` | 노쇼 처리 |
| `GET` | `/v1/housekeeping/rooms` | 객실 상태 |
| `PUT` | `/v1/housekeeping/rooms/:roomNumber/status` | 객실 상태 변경 |
| `GET` | `/v1/business-date` | 호텔 영업일 |
| `GET` | `/v1/profiles/:profileId` | 게스트 프로필 단건 |
| `POST` | `/v1/profiles/:profileId/merge` | 중복 프로필 병합 |

예약 경로는 OPERA 를 따라 세 축(`sourceCode` · `marketCode` · `channelCode`)으로 둡니다.
설정에 없는 코드는 거절합니다 — 통과시키면 오타가 그대로 집계에 들어가 `BOOKINGCOM` 과
`BOOKING.COM` 이 서로 다른 채널이 되고, 채널별 실적은 그 순간부터 신뢰할 수 없습니다.

영업일은 달력 날짜와 다릅니다. 야간 감사를 돌리기 전까지는 자정을 넘겨도 어제가
영업일로 남고, 매출과 점유율이 어느 날짜에 붙는지가 그 값으로 정해집니다. 마감을
언제 돌렸는지는 OPERA 만 알기 때문에 계산하지 않고 그대로 읽습니다.

### 오류 변환

OPERA 가 거절한 사유 중 호출자가 고칠 수 있는 것(400·404·409·422)은 상태 코드와
메시지를 그대로 내려보냅니다. 전부 502 로 뭉개면 "출발일이 도착일보다 앞섭니다" 같은
입력 오류가 화면에서 게이트웨이 장애로 보이고, FE 는 재시도해도 소용없는 요청을
다시 보냅니다. 401·403 은 우리 자격 증명 문제이므로 502 로 감춥니다.

스키마는 TypeBox 로 선언하며, 런타임 검증과 OpenAPI 문서가 같은 정의에서 나옵니다.
`pnpm openapi:export` 로 `openapi/planforge-core.json` 을 생성해 BE 클라이언트 생성에 씁니다.

## 구조

```
src/
  config/env.ts        환경변수 로딩 및 운영 필수값 검증
  opera/
    token-store.ts     OHIP OAuth2 토큰 캐시 (동시 갱신 병합, 401 시 무효화)
    client.ts          OHIP REST 호출 래퍼 (401 1회 재시도)
    mock-transport.ts  OHIP_MODE=mock 일 때의 모의 전송 계층
    reservation-mapper.ts / block-mapper.ts   OPERA ↔ PlanForge 매핑
    errors.ts          OperaApiError / OperaAuthError
  plugins/auth.ts      내부 서비스 API 키 인증
  routes/              가용 현황 · 요금 · 예약 · 블록 · 하우스키핑 라우트
  schemas/             TypeBox 요청/응답 스키마
  scripts/             OpenAPI 문서 내보내기
```

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `PORT` | 서버 포트 (기본 `3002`) |
| `SERVICE_API_KEY` | 내부 호출자 인증 키. 비우면 개발용으로 인증 생략 |
| `CORS_ORIGIN` | 허용 오리진 (쉼표 구분) |
| `OHIP_BASE_URL` | OHIP 게이트웨이 주소 |
| `OHIP_APP_KEY` | OHIP 애플리케이션 키 (`x-app-key`) |
| `OHIP_CLIENT_ID` / `OHIP_CLIENT_SECRET` | OAuth2 클라이언트 자격 증명 |
| `OHIP_USERNAME` / `OHIP_PASSWORD` | OPERA Cloud 통합 사용자 |
| `OHIP_HOTEL_ID` | 기본 호텔 코드 |

`NODE_ENV=production` 으로 기동하면 위 값이 비어 있을 때 즉시 실패합니다.

## 모의 모드 (`OHIP_MODE=mock`)

전송 계층만 바꿉니다. 응답 매핑은 live 와 똑같이 태우므로 실제 연동으로 옮길 때
달라지는 것은 `mock-transport.ts` 하나입니다.

모의 저장소는 **프로세스 수명만큼만** 삽니다. Core 를 재시작하면 그동안 발급한 예약·
프로필·블록을 잊는 반면 BE 의 데이터베이스는 남아 있어, 로컬 개발 중에는 둘이 어긋날 수
있습니다. 어긋나면 BE 에서 `pnpm prisma:seed` 로 맞춰 주세요.

## 배포

`Dockerfile` 로 이미지를 만듭니다. 멀티스테이지에 비-root(`node`) 실행이며,
`/health` 를 보는 HEALTHCHECK 가 들어 있습니다.

```bash
docker build -t planforge-core .
```

**Core 는 외부에 노출하지 않습니다.** OHIP 클라이언트 시크릿과 OPERA 통합 계정을
들고 있어, 내부 네트워크에서 BE 만 호출하도록 두어야 합니다. 전체 스택 구성은
BE 리포의 `deploy/docker-compose.yml` 을 참고하세요.

이미지는 태그를 밀 때만 GHCR 에 발행됩니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | 개발 서버 (watch) |
| `pnpm build` / `pnpm start` | 빌드 / 프로덕션 실행 |
| `pnpm test` | Vitest |
| `pnpm openapi:export` | OpenAPI 문서 생성 |
| `pnpm lint` / `pnpm typecheck` | 검사 |

## 라이선스

UNLICENSED — 사내 전용.
