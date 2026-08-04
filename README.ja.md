<div align="center">

# PlanForge Core

**Oracle OPERA Cloud（OHIP）連携ゲートウェイ**

ホテル管理プラットフォーム PlanForge の API サーバー。OPERA 認証・トークンキャッシュ・
レスポンス正規化・エラー変換を担います。

[한국어](README.md) · [English](README.en.md) · [中文](README.zh.md) · **日本語**

![TypeScript](https://img.shields.io/badge/TypeScript-87.8%25-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Markdown](https://img.shields.io/badge/Markdown-3.6%25-083FA1?style=flat-square)
![YAML](https://img.shields.io/badge/YAML-2.9%25-CB171E?style=flat-square)
![JSON](https://img.shields.io/badge/JSON-2.1%25-000000?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-0.9%25-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## プロジェクト背景

予約・在庫・料金の**記録の源泉は OPERA** です。在庫判定・料金計算・確認番号の発行を PlanForge
が独自に行えば、いずれ二つのシステムの値がずれ、どちらが正しいかを判断する根拠がなくなります。
会計データにおいてこれは致命的です。

そのため Core は**薄い委譲レイヤー**です。形を変えて OPERA に渡し、返ってきたものをそのまま
返します。OHIP のフィールド名を知るコードはマッパーファイル数点に閉じ込めてあり、実際の
サブスクリプション仕様を受け取ったらそれらを直すだけで済みます。

Core は**外部に公開しません。** OHIP クライアントシークレットと OPERA 統合アカウントを保持する
ため、内部ネットワークから BE のみが呼び出せる構成にします。

### プラットフォーム構成

| リポジトリ | 役割 |
| --- | --- |
| [PlanForge-Package-FE](https://github.com/PlanForge-Package/PlanForge-Package-FE) | 運営・フロントデスク Web UI |
| [PlanForge-Package-BE](https://github.com/PlanForge-Package/PlanForge-Package-BE) | 業務ロジック・自前データベース |
| **PlanForge-Package-Core** | **Oracle OPERA（OHIP）連携 API サーバー** |

呼び出し経路：`FE → BE → Core → OPERA Cloud (OHIP)`

---

## 言語とスタック

| 区分 | 技術 |
| --- | --- |
| 言語 | TypeScript 5.9（strict） |
| ランタイム | Node.js 20.11+ |
| Web フレームワーク | Fastify 5 |
| スキーマ・検証 | TypeBox —— 同一定義からランタイム検証と OpenAPI を生成 |
| API ドキュメント | `@fastify/swagger` · Swagger UI（`/docs`） |
| セキュリティ | `@fastify/helmet` · `@fastify/cors` · `@fastify/rate-limit` |
| ロギング | Pino（認証ヘッダーを自動マスキング） |
| テスト | Vitest —— 58 件 |
| 品質 | ESLint · Prettier · GitHub Actions |
| デプロイ | Docker（マルチステージ・非 root 実行・HEALTHCHECK） |
| パッケージ管理 | pnpm 9 |

---

## ディレクトリ構成

```
src/
├── config/
│   └── env.ts                    環境変数の読み込み・本番必須値の検証
├── opera/
│   ├── token-store.ts            OHIP OAuth2 トークンキャッシュ（同時更新の統合、401 で無効化）
│   ├── client.ts                 OHIP REST 呼び出しラッパー（401 時に 1 回リトライ）
│   ├── mock-transport.ts         OHIP_MODE=mock 時のモック転送レイヤー
│   ├── reservation-mapper.ts     予約 OPERA ↔ PlanForge マッピング
│   ├── block-mapper.ts           団体ブロックのマッピング
│   └── errors.ts                 OperaApiError · OperaAuthError
├── plugins/
│   └── auth.ts                   内部サービス API キー認証（x-api-key）
├── routes/
│   ├── availability.ts           期間別の客室在庫
│   ├── rates.ts                  期間料金
│   ├── reservations.ts           予約の照会・作成・変更・取消・ノーショー
│   ├── blocks.ts                 団体ブロック・ルーミングリスト
│   ├── profiles.ts               ゲストプロファイル・重複統合
│   ├── housekeeping.ts           客室ステータス
│   ├── night-audit.ts            営業日
│   └── health.ts                 ヘルスチェック（認証不要）
├── schemas/                      TypeBox リクエスト / レスポンススキーマ
├── scripts/
│   └── export-openapi.ts         OpenAPI ドキュメント出力
└── server.ts
```

---

## 実行方法

### 必要環境

- Node.js 20.11 以上
- pnpm 9

### インストールと起動

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| URL | 用途 |
| --- | --- |
| `http://localhost:3002` | API |
| `http://localhost:3002/docs` | Swagger UI |
| `http://localhost:3002/health` | ヘルスチェック（認証不要） |

### 主なコマンド

| コマンド | 説明 |
| --- | --- |
| `pnpm dev` | 開発サーバー（watch） |
| `pnpm build` / `pnpm start` | ビルド / 本番実行 |
| `pnpm test` | Vitest |
| `pnpm openapi:export` | `openapi/planforge-core.json` を生成 |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | 品質チェック |

### 環境変数

| 名前 | 説明 |
| --- | --- |
| `PORT` | サーバーポート（既定 `3002`） |
| `SERVICE_API_KEY` | 内部呼び出し元の認証キー。空ならローカル開発用に認証を省略 |
| `CORS_ORIGIN` | 許可オリジン（カンマ区切り） |
| `OHIP_MODE` | `mock` \| `live` —— 既定は `mock` |
| `OHIP_BASE_URL` | OHIP ゲートウェイのアドレス |
| `OHIP_APP_KEY` | OHIP アプリケーションキー（`x-app-key`） |
| `OHIP_CLIENT_ID` / `OHIP_CLIENT_SECRET` | OAuth2 クライアント資格情報 |
| `OHIP_USERNAME` / `OHIP_PASSWORD` | OPERA Cloud 統合ユーザー |
| `OHIP_HOTEL_ID` | 既定のホテルコード |

`NODE_ENV=production` で起動した際、上記が空、または `OHIP_MODE` が `live` でない場合は
**即座に失敗します。** モックモードのまま本番に立つと、偽の予約が本物のように流通します。

### モックモード（`OHIP_MODE=mock`）

転送レイヤーだけを差し替えます。レスポンスのマッピングは live と同じ経路を通るため、実連携へ
移す際に変わるのは `mock-transport.ts` ひとつだけです。サブスクリプション仕様と資格情報が
なくても、FE・BE を含む全区間を開発・検証できます。

モックストアは**プロセスの寿命の間だけ**生きています。Core を再起動すると発行済みの予約・
プロファイル・ブロックを忘れる一方、BE のデータベースには残るためズレが生じ得ます。ズレたら
BE で `pnpm prisma:seed` を実行して揃えてください。

---

## 提供エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| `GET` | `/health` | サービス状態 |
| `GET` | `/v1/availability` | 期間別の客室在庫 |
| `GET` | `/v1/rates` | 期間料金 |
| `GET` | `/v1/reservations` | 予約一覧 |
| `GET` | `/v1/reservations/:reservationId` | 予約単件 |
| `POST` | `/v1/reservations` | 予約作成 |
| `PATCH` | `/v1/reservations/:reservationId` | 予約変更 |
| `POST` | `/v1/reservations/:reservationId/cancel` | 予約取消 |
| `POST` | `/v1/reservations/:reservationId/no-show` | ノーショー処理 |
| `POST` | `/v1/reservations/:reservationId/check-in` | チェックイン（客室割当を含む） |
| `POST` | `/v1/reservations/:reservationId/check-out` | チェックアウト |
| `GET` | `/v1/blocks` | 団体ブロック一覧 |
| `GET` | `/v1/blocks/:blockId` | ブロック単件 —— 日付・客室タイプ別の割当 |
| `GET` | `/v1/blocks/:blockId/reservations` | ルーミングリスト |
| `POST` | `/v1/blocks` | ブロック作成 |
| `PATCH` | `/v1/blocks/:blockId` | ブロック変更 |
| `GET` | `/v1/profiles/:profileId` | ゲストプロファイル単件 |
| `POST` | `/v1/profiles/:profileId/merge` | 重複プロファイルの統合 |
| `GET` | `/v1/housekeeping/rooms` | 客室ステータス |
| `PUT` | `/v1/housekeeping/rooms/:roomNumber/status` | 客室ステータス変更 |
| `GET` | `/v1/housekeeping/outages` | 使用不可客室の一覧 |
| `POST` | `/v1/housekeeping/outages` | 客室を使用不可として登録 |
| `DELETE` | `/v1/housekeeping/outages/:outageId` | 使用不可の解除 |
| `GET` | `/v1/business-date` | ホテルの営業日 |

### 設計判断

**エラー変換** —— OPERA が拒否した理由のうち呼び出し元が直せるもの（400 · 404 · 409 · 422）は、
ステータスコードとメッセージをそのまま返します。すべて 502 に潰すと「出発日は到着日より後で
なければなりません」のような入力エラーが画面上ではゲートウェイ障害に見え、FE は決して成功
しないリクエストを再送します。401・403 は当方の資格情報の問題なので 502 で隠します。

**予約経路** —— OPERA に倣い三軸（`sourceCode` · `marketCode` · `channelCode`）で保持します。
設定にないコードは拒否します。通すとタイプミスがそのまま集計に入り、`BOOKINGCOM` と
`BOOKING.COM` が別チャネルになって、チャネル別実績はその瞬間から信用できなくなります。

**営業日** —— カレンダー日付とは異なります。ナイトオーディットを回すまでは深夜を過ぎても昨日が
営業日のままで、売上と稼働率がどの日に付くかはその値で決まります。監査をいつ回したかは OPERA
だけが知っているため、計算せずそのまま読み取ります。

---

## デプロイ

```bash
docker build -t planforge-core .
```

マルチステージ・非 root（`node`）実行で、`/health` を見る HEALTHCHECK が入っています。スタック
全体の構成は BE リポジトリの `deploy/docker-compose.yml` を参照してください。イメージはタグを
プッシュしたときのみ GHCR に発行されます。

> **⚠️ 既知の制約** —— OHIP のレスポンス形式は一般的な規約に基づく**推定値**です。実際の
> サブスクリプション仕様を受け取ったら、`mock-transport.ts` とマッパーファイルを併せて合わせる
> 必要があります。

---

## ライセンス

UNLICENSED —— 社内専用。
