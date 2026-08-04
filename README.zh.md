<div align="center">

# PlanForge Core

**Oracle OPERA Cloud（OHIP）对接网关**

酒店管理平台 PlanForge 的 API 服务器，负责 OPERA 认证、令牌缓存、响应规范化与错误转换。

[한국어](README.md) · [English](README.en.md) · **中文** · [日本語](README.ja.md)

![TypeScript](https://img.shields.io/badge/TypeScript-87.8%25-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Markdown](https://img.shields.io/badge/Markdown-3.6%25-083FA1?style=flat-square)
![YAML](https://img.shields.io/badge/YAML-2.9%25-CB171E?style=flat-square)
![JSON](https://img.shields.io/badge/JSON-2.1%25-000000?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-0.9%25-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## 项目背景

预订、库存与房价的**记录源头是 OPERA**。如果 PlanForge 自行判断库存、计算房价、生成确认号，
两套系统的数值终将出现分歧，届时没有任何依据判断哪一方正确。对会计数据而言这是致命的。

因此 Core 是一层**很薄的委托层**：只做格式转换，交给 OPERA 处理，再原样返回结果。了解 OHIP
字段名的代码被收敛在少数几个映射文件中；拿到正式订阅规格后，只需改动这些文件。

Core **不对外暴露**。它持有 OHIP 客户端密钥与 OPERA 集成账号，只允许 BE 在内网调用。

### 平台构成

| 仓库 | 职责 |
| --- | --- |
| [PlanForge-Package-FE](https://github.com/PlanForge-Package/PlanForge-Package-FE) | 运营 / 前台 Web 界面 |
| [PlanForge-Package-BE](https://github.com/PlanForge-Package/PlanForge-Package-BE) | 业务逻辑 · 自有数据库 |
| **PlanForge-Package-Core** | **Oracle OPERA（OHIP）对接 API 服务器** |

调用链路：`FE → BE → Core → OPERA Cloud (OHIP)`

---

## 语言与技术栈

| 分类 | 技术 |
| --- | --- |
| 语言 | TypeScript 5.9（strict） |
| 运行时 | Node.js 20.11+ |
| Web 框架 | Fastify 5 |
| 模式与校验 | TypeBox —— 同一份定义同时产出运行时校验与 OpenAPI |
| API 文档 | `@fastify/swagger` · Swagger UI（`/docs`） |
| 安全 | `@fastify/helmet` · `@fastify/cors` · `@fastify/rate-limit` |
| 日志 | Pino（自动脱敏认证头） |
| 测试 | Vitest —— 58 个用例 |
| 质量 | ESLint · Prettier · GitHub Actions |
| 部署 | Docker（多阶段构建 · 非 root 运行 · HEALTHCHECK） |
| 包管理 | pnpm 9 |

---

## 目录结构

```
src/
├── config/
│   └── env.ts                    环境变量加载 · 生产环境必填校验
├── opera/
│   ├── token-store.ts            OHIP OAuth2 令牌缓存（并发刷新合并、401 时失效）
│   ├── client.ts                 OHIP REST 调用封装（401 重试一次）
│   ├── mock-transport.ts         OHIP_MODE=mock 时的模拟传输层
│   ├── reservation-mapper.ts     预订 OPERA ↔ PlanForge 映射
│   ├── block-mapper.ts           团队房控映射
│   └── errors.ts                 OperaApiError · OperaAuthError
├── plugins/
│   └── auth.ts                   内部服务 API Key 认证（x-api-key）
├── routes/
│   ├── availability.ts           指定期间的可售房况
│   ├── rates.ts                  指定期间的房价
│   ├── reservations.ts           预订查询 · 创建 · 修改 · 取消 · No-show
│   ├── blocks.ts                 团队房控 · 房单
│   ├── profiles.ts               客史档案 · 重复合并
│   ├── housekeeping.ts           房态
│   ├── night-audit.ts            营业日
│   └── health.ts                 健康检查（无需认证）
├── schemas/                      TypeBox 请求 / 响应模式
├── scripts/
│   └── export-openapi.ts         导出 OpenAPI 文档
└── server.ts
```

---

## 运行方式

### 环境要求

- Node.js 20.11 以上
- pnpm 9

### 安装与启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3002` | API |
| `http://localhost:3002/docs` | Swagger UI |
| `http://localhost:3002/health` | 健康检查（无需认证） |

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发服务器（watch） |
| `pnpm build` / `pnpm start` | 构建 / 生产运行 |
| `pnpm test` | Vitest |
| `pnpm openapi:export` | 生成 `openapi/planforge-core.json` |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | 质量检查 |

### 环境变量

| 名称 | 说明 |
| --- | --- |
| `PORT` | 服务端口（默认 `3002`） |
| `SERVICE_API_KEY` | 内部调用方密钥。留空则本地开发跳过认证 |
| `CORS_ORIGIN` | 允许的来源（逗号分隔） |
| `OHIP_MODE` | `mock` \| `live` —— 默认 `mock` |
| `OHIP_BASE_URL` | OHIP 网关地址 |
| `OHIP_APP_KEY` | OHIP 应用密钥（`x-app-key`） |
| `OHIP_CLIENT_ID` / `OHIP_CLIENT_SECRET` | OAuth2 客户端凭据 |
| `OHIP_USERNAME` / `OHIP_PASSWORD` | OPERA Cloud 集成用户 |
| `OHIP_HOTEL_ID` | 默认酒店代码 |

以 `NODE_ENV=production` 启动时，若上述值为空或 `OHIP_MODE` 不是 `live`，服务将**立即失败**。
模拟模式跑在生产环境上，会让虚假预订像真实预订一样流通。

### 模拟模式（`OHIP_MODE=mock`）

只替换传输层。响应映射与 live 完全一致，因此切换到真实对接时只需改动 `mock-transport.ts`。
没有订阅规格与凭据，也能完成 FE、BE 在内的全链路开发与验证。

模拟存储**只在进程存活期间有效**。重启 Core 后会遗忘此前发放的预订、客史与房控，而 BE 的
数据库仍保留，两者可能不一致。出现不一致时，在 BE 执行 `pnpm prisma:seed` 对齐。

---

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务状态 |
| `GET` | `/v1/availability` | 指定期间的可售房况 |
| `GET` | `/v1/rates` | 指定期间的房价 |
| `GET` | `/v1/reservations` | 预订列表 |
| `GET` | `/v1/reservations/:reservationId` | 单条预订 |
| `POST` | `/v1/reservations` | 创建预订 |
| `PATCH` | `/v1/reservations/:reservationId` | 修改预订 |
| `POST` | `/v1/reservations/:reservationId/cancel` | 取消预订 |
| `POST` | `/v1/reservations/:reservationId/no-show` | No-show 处理 |
| `POST` | `/v1/reservations/:reservationId/check-in` | 入住（含分房） |
| `POST` | `/v1/reservations/:reservationId/check-out` | 离店 |
| `POST` | `/v1/reservations/:reservationId/confirm-waitlist` | 候补转确认（复核房态） |
| `POST` | `/v1/reservations/:reservationId/share` | 共享客房 —— 两笔预订同住一间 |
| `POST` | `/v1/reservations/:reservationId/unshare` | 解除共享 |
| `GET` `POST` | `/v1/reservations/:id/folios` | 查询账单 · 开设账窗 |
| `POST` | `/v1/reservations/:id/folios/:window/postings` | 登记账目 |
| `POST` | `/v1/reservations/:id/folios/postings/:postingId/void` | 冲销账目 |
| `POST` | `/v1/reservations/:id/folios/postings/:postingId/transfer` | 账窗间转移 |
| `POST` | `/v1/reservations/:id/folios/:window/close` | 账单结账 |
| `GET` | `/v1/blocks` | 团队房控列表 |
| `GET` | `/v1/blocks/:blockId` | 单个房控 —— 按日期与房型的配额 |
| `GET` | `/v1/blocks/:blockId/reservations` | 房单 |
| `POST` | `/v1/blocks` | 创建房控 |
| `PATCH` | `/v1/blocks/:blockId` | 修改房控 |
| `GET` | `/v1/profiles/:profileId` | 单条客史档案 |
| `POST` | `/v1/profiles/:profileId/merge` | 合并重复档案 |
| `GET` | `/v1/housekeeping/rooms` | 房态 |
| `PUT` | `/v1/housekeeping/rooms/:roomNumber/status` | 变更房态 |
| `GET` | `/v1/housekeeping/outages` | 停用房间列表 |
| `POST` | `/v1/housekeeping/outages` | 登记房间停用 |
| `DELETE` | `/v1/housekeeping/outages/:outageId` | 解除停用 |
| `GET` | `/v1/business-date` | 酒店营业日 |

### 设计取舍

**错误转换** —— OPERA 拒绝的原因中，调用方能够修正的（400 · 404 · 409 · 422）会连同状态码与
消息原样下发。若一律压成 502，"离店日必须晚于抵店日"这类输入错误在界面上会表现为网关故障，
前端还会重试一个永远不会成功的请求。401 与 403 属于我方凭据问题，因此隐藏为 502。

**预订来源** —— 依照 OPERA 拆成三个维度（`sourceCode` · `marketCode` · `channelCode`）。不在
配置内的代码一律拒绝：放行错别字会让 `BOOKINGCOM` 与 `BOOKING.COM` 成为两个渠道，渠道业绩从
那一刻起便不可信。

**营业日** —— 与日历日期不同。夜审执行之前，即使过了午夜，营业日仍是昨天；营业额与出租率
归属哪一天由该值决定。夜审何时执行只有 OPERA 知道，因此不自行计算而是直接读取。

---

## 部署

```bash
docker build -t planforge-core .
```

多阶段构建、以非 root（`node`）运行，并内置针对 `/health` 的 HEALTHCHECK。完整栈配置请参考 BE
仓库的 `deploy/docker-compose.yml`。镜像仅在推送标签时发布到 GHCR。

> **⚠️ 已知限制** —— OHIP 响应结构是依据通用惯例的**推测值**。拿到正式订阅规格后，需同步调整
> `mock-transport.ts` 与各映射文件。

---

## 许可

UNLICENSED —— 仅限公司内部使用。
