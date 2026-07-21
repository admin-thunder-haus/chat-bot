# AI Customer Support Platform

A production-ready foundation for a **multi-tenant AI customer support platform**.
Companies register an account, and each account is fully isolated from the
others.

- **Day 1** — project foundation, authentication, company/tenant structure,
  database, validation, middleware, Docker environment, minimal frontend auth.
- **Day 2** — company profile & business configuration the future AI assistant
  will use: services & pricing, business hours, FAQs, knowledge base, AI
  behavior settings, plus a full dashboard. See
  [Day 2 features](#day-2--business-configuration).
- **Day 3** — a unified **Inbox**: customers, conversations, messages, internal
  notes, assignment, status/priority, tags, conversation activity/audit,
  manual outbound replies, and a development-only mock inbound endpoint. Also
  fixes a rate-limit ("Too Many Requests") issue. See
  [Day 3 features](#day-3--inbox--conversations).
- **Day 4** — a secure **AI response engine** (OpenAI): AI drafts, direct AI
  replies, optional auto-reply for mock inbound, keyword knowledge retrieval,
  prompt-injection defenses, human handoff / AI modes, usage & estimated-cost
  tracking, quotas, an AI Playground, and Inbox AI controls. Also fixes an Inbox
  message-history bug via cursor pagination. See
  [Day 4 features](#day-4--ai-response-engine).
- **Day 5 Part 1** — a reusable **channel integration framework**: a provider
  interface + registry, typed capabilities, an encrypted credential store
  (AES-256-GCM), normalized incoming/outgoing events, a generic signed **webhook
  engine**, one shared incoming + outgoing **pipeline**, channel accounts +
  delivery + audit models, a development **fake/test provider**, channel
  connection-health, tenant-scoped channel APIs, and a dashboard **Channels**
  page. No real platform is connected yet. See
  [Day 5 Part 1 features](#day-5-part-1--channel-integration-framework).
- **Day 5 Part 2** — a production-grade **delivery engine**: full delivery
  lifecycle, a configurable **retry strategy** (exponential backoff + jitter,
  permanent vs temporary failures), delivery **status callbacks** (monotonic +
  idempotent), strengthened **idempotency**, **failure recovery** (atomic claim,
  crash re-queue, manual retry), extended **channel health monitoring** (health
  score, counters, history, degradation/recovery), a **diagnostics** API, and a
  Channels **monitoring dashboard**. Queue-ready (no Redis/worker yet). Real
  providers are still **not connected**. See
  [Day 5 Part 2 features](#day-5-part-2--delivery-engine--health-monitoring).
- **Day 5 Part 3** — the **first real provider: Web Chat**, plus a
  production-quality **website widget**. A `webchat` provider on the existing
  framework, a public widget API (sessions, visitor persistence, reconnect,
  polling, typing), a self-contained embeddable widget (no third-party libs) with
  a loader + iframe, a dashboard **config page** (live preview, theme, generated
  embed snippet), and full **AI + Inbox integration** through the same pipeline.
  It is the reference implementation for WhatsApp/Messenger/Instagram/Telegram —
  which will later add only provider adapters. Those remain **not connected**.
  See [Day 5 Part 3 features](#day-5-part-3--web-chat-provider--website-widget).
- **Day 6** — the **first real social platform: WhatsApp Business Cloud API
  (Meta)**. A production `whatsapp` provider on the same framework: Meta webhook
  verification + `X-Hub-Signature-256` signatures, defensive payload parsing
  (text, delivery/read status, unsupported/unknown/malformed — never crashes),
  Graph API sending with retry classification (auth/429/5xx/network), health
  checks, and **per-account encrypted credentials**. Multiple numbers / Business
  Accounts / companies, each a channel account. Incoming/outgoing flow through
  the existing pipeline + delivery engine + AI — **no business-logic change**.
  See [Day 6 features](#day-6--whatsapp-business-cloud-api).

> Future milestones (not built yet): **real** WhatsApp / Instagram / Facebook
> Messenger / Telegram / Web Chat integrations, billing, Redis, queues, retry
> workers, and real-time sockets. Day 5 Part 1 builds only the reusable
> foundation — **no real channel is connected**, and all channel traffic is
> exercised through the development fake provider.

---

## Table of contents

- [Day 7 — Instagram Messaging (Meta)](#day-7--instagram-messaging-meta)
- [Day 6 — WhatsApp Business Cloud API](#day-6--whatsapp-business-cloud-api)
- [Day 5 Part 3 — Web Chat provider & website widget](#day-5-part-3--web-chat-provider--website-widget)
- [Day 5 Part 2 — delivery engine & health monitoring](#day-5-part-2--delivery-engine--health-monitoring)
- [Day 5 Part 1 — channel integration framework](#day-5-part-1--channel-integration-framework)
- [Day 4 — AI response engine](#day-4--ai-response-engine)
- [Day 3 — inbox & conversations](#day-3--inbox--conversations)
- [Day 2 — business configuration](#day-2--business-configuration)
- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Quick start (Docker)](#quick-start-docker)
- [Local development (without Docker)](#local-development-without-docker)
- [Environment variables](#environment-variables)
- [Database & migrations](#database--migrations)
- [Seeding](#seeding)
- [Testing](#testing)
- [Available scripts](#available-scripts)
- [API endpoints](#api-endpoints)
- [Demo credentials](#demo-credentials)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## Day 7 — Instagram Messaging (Meta)

Day 7 ships the **second real Meta platform — Instagram Messaging** — the first
provider added *entirely on top of* the existing generic Channel Framework with
**zero schema changes**. Instagram Direct Messages flow through the exact same
Unified Inbox, AI, delivery, retry, health, and activity machinery as Web Chat
and WhatsApp. All Instagram-specific behavior is confined to the provider module.

```
Instagram customer → Meta webhook → Instagram provider → normalized event
  → generic incoming pipeline → Customer + Conversation + Message
  → optional AI reply → generic delivery engine → Instagram provider → customer
```

### Meta account model

Instagram messaging spans several Meta objects. Day 7 stores each in the correct
safe field and **routes only by stable IDs — never the @username**:

| Concept | Stored as | Notes |
| --- | --- | --- |
| Instagram professional account ID | `ChannelAccount.externalAccountId` | Stable routing + send target |
| Facebook Page ID | `ChannelAccount.externalPageId` | Optional, where the setup links a Page |
| Instagram @username | `metadata.instagram.instagramUsername` | Display only, never a routing key |
| Business name | `metadata.instagram.businessName` | Display only |
| Access token / App secret / Verify token | encrypted `ChannelCredential` | AES-256-GCM, never returned |

### Capabilities (honest)

`textMessages`, `inboundMessaging`, `outboundMessaging`, `messageReplies`,
`readReceipts`, `customerProfiles`, `webhookVerification`, `webhookSignatures` →
**true**. `deliveryReceipts` → **false** (Instagram DMs do not emit delivery
callbacks; only `read`). `mediaMessages`, `templates`, `reactions`,
`typingIndicators` → **false** (architecture-ready; inbound media/reactions are
recorded as `unsupported`, never processed). The Inbox hides controls for
unsupported capabilities automatically.

### Required account prerequisites

- An eligible Instagram **professional** (Business or Creator) account
- A connected **Facebook Page** (where the setup requires it)
- A **Meta app** with the Instagram messaging product + `instagram_manage_messages`
- A valid **access token**; **app secret**; and a **verify token** you choose
- The Meta **webhook** configured for this channel's URL and subscribed to `messages`

### Manual developer connection

`POST /api/v1/channels/instagram/connect` (OWNER/ADMIN). Body fields:
`displayName`, `instagramAccountId` (required), `instagramUsername?`,
`facebookPageId?`, `businessName?`, `accessToken`, `appSecret`, `verifyToken`.
`companyId` and any other unknown field are **rejected** (`.strict()`); the tenant
is always derived server-side from the JWT. On connect the backend stores the
encrypted credentials **and immediately validates them against the Graph API**,
so the reported state is honest — `HEALTHY` ("verified and active"),
`AUTH_EXPIRED`, or a saved-but-pending state — never a blind "connected".

> Embedded Signup / OAuth onboarding is **postponed** to the shared onboarding
> phase. Day 7 uses the manual developer flow only.

### Credential encryption

Secrets are encrypted with the existing per-account `ChannelCredential`
(AES-256-GCM via `CHANNEL_CREDENTIAL_ENCRYPTION_KEY`), decrypted only inside
backend integration services, never cached globally, and **never** placed in
metadata, API responses, diagnostics, logs, activity, errors, or the frontend.

### Webhook

- URL: `https://<PUBLIC_BACKEND>/api/v1/webhooks/instagram/<CHANNEL_ACCOUNT_ID>`
- `GET` verifies `hub.challenge` against the account's **verify token**.
- `POST` validates the Meta **X-Hub-Signature-256** HMAC (app secret) over the
  raw body **before** the payload is trusted; unknown accounts and bad signatures
  return a generic response and never reveal whether an account id exists.
- Reuses the generic public webhook engine + its dedicated rate limiter (no JWT).
- Instagram uses the Messenger-style `entry[].messaging[]` shape (object
  `instagram`); the parser is fully defensive and never throws on unknown fields.

### Incoming / outgoing / AI

Incoming: signature → parse → normalize → idempotency (per company + account +
external id) → resolve/create customer (by IGSID) → create/reopen conversation
linked to the Instagram account → inbound message → activity → optional AI
auto-reply through the existing AI flow. Outgoing (agent or AI): the generic
delivery engine calls the provider's Graph API client
(`POST /{IG_ID}/messages` `{recipient:{id},message:{text}}`); the external
message id is stored; internal notes are never sent; empty messages are rejected;
retry/failure classification reuses the Day 5 engine.

### Retry classification

`instagram-error-classifier.ts` maps Meta `code`/`error_subcode` + HTTP status →
`AUTHENTICATION`, `AUTHORIZATION`, `RATE_LIMIT`, `TEMPORARY_PROVIDER_FAILURE`,
`NETWORK_FAILURE`, `TIMEOUT`, `INVALID_RECIPIENT`, `INVALID_REQUEST`,
`PERMANENT_PROVIDER_FAILURE`, `UNKNOWN_PROVIDER_FAILURE`. 429 / 5xx / network /
timeout are retryable; invalid token, missing permission, and invalid
recipient/request are permanent.

### Health & diagnostics

Health check reads the Instagram account node (`GET /{IG_ID}?fields=id,username,name`)
with the decrypted token, verifies an **identity match**, and updates the existing
health fields (`connectionState`, `lastHealthCheckAt`, `lastHealthyAt`,
`lastErrorCode/Message`, health score/counters/history). Invalid token →
`AUTH_EXPIRED`; missing permission / temporary Meta issue → `DEGRADED`;
inaccessible / mismatched account → `UNAVAILABLE`; success → `HEALTHY`.
Diagnostics reuse the generic screen and never expose secrets.

### API routes

| Method | Route | Role |
| --- | --- | --- |
| `POST` | `/api/v1/channels/instagram/connect` | OWNER / ADMIN |
| `GET/POST` | `/api/v1/webhooks/instagram/:channelAccountId` | public (no JWT) |

All other management uses the existing generic channel routes
(`GET /channels`, `/channels/:id`, `PATCH /:id/status`, `DELETE /:id`,
`POST /:id/health-check`, `GET /:id/diagnostics`).

### Role matrix

OWNER = ADMIN: connect, view, update safe fields, enable/disable, disconnect,
health check, diagnostics. AGENT: view accounts + capabilities, use Instagram
conversations in the Inbox and send permitted replies — **cannot** connect, edit
credentials, disconnect, or run privileged connection actions. Webhook routes
carry no JWT; tenant routing is derived from the resolved ChannelAccount only.

### Environment variables (Day 7)

```
INSTAGRAM_PROVIDER_ENABLED=true          # set false to disable the provider entirely
INSTAGRAM_GRAPH_API_BASE_URL=https://graph.facebook.com
INSTAGRAM_GRAPH_API_VERSION=v21.0
INSTAGRAM_API_TIMEOUT_MS=15000
```

Per-account secrets are **never** global env — they are supplied at connect time
and encrypted per account.

### Database

**No migration was required.** The generic framework (`ChannelAccount`,
`ChannelCredential`, `ChannelWebhookEvent`, `ChannelDelivery`,
`ChannelHealthCheck`, `Conversation`, `Message`, `Customer`, generic
`ChannelActivityType`, and the `INSTAGRAM` `ChannelType` enum value) already
supported Instagram end-to-end.

### Tests

`tests/instagram-provider.test.ts` (unit: registration, capabilities, connect
prep, verification, signatures, parsing/normalization of text/echo/read/media/
malformed/unknown/empty, send outcomes, health states, error classification) and
`tests/instagram.test.ts` (integration via Supertest: connect roles + duplicate
409 + companyId rejection + false-success guard + cross-tenant 404, webhook
verify/signature, incoming pipeline + idempotency + AI + cross-tenant isolation,
outbound send + note-not-sent + permanent-failure + read receipt + cross-tenant
block, health + AGENT restriction + diagnostics-no-secrets). Full suite: **35
suites / 332 tests passing** (was 282). No Meta network is ever called — the
transport is dependency-injected.

### Manual Meta setup + verification

See the manual verification steps in the completion notes: add a test recipient,
configure the webhook (callback URL above + your verify token + subscribe
`messages`), DM the account, confirm one message in the Inbox, reply, confirm it
reaches Instagram.

### Docker

`docker compose up --build` then `docker compose ps` — backend + postgres come up
healthy, migrations apply cleanly, seed stays idempotent, and the provider catalog
reports Instagram `available: true`.

### Known limitations / not implemented

Embedded Signup / OAuth onboarding (postponed), **Facebook Messenger** (Day 8),
media send/download, comments, mentions, story replies/mentions, reactions,
message deletion/editing, publishing, feed/ads/marketing. Instagram DMs do not
provide delivery (only read) receipts.

---

## Day 6 — WhatsApp Business Cloud API

Day 6 ships the **first real social platform — WhatsApp Business Cloud API
(Meta)** — as a `whatsapp` provider on the existing Channel Framework. **Zero**
WhatsApp-specific logic lives in Conversation / Message / Customer / Inbox / AI /
business modules: everything platform-specific is inside the provider. Adding
WhatsApp required **no migration** and no change to the core pipeline.

### Architecture — one small, generic extension

Web Chat and the fake provider use *global* secrets; WhatsApp needs *per-account*
secrets (each number has its own token/app-secret/verify-token). The only
framework change is a generic **credential channel**:

- `ChannelProvider.requiresCredentials` + optional `credentials` on the
  webhook/send/health inputs + a `prepareConnection` hook.
- `channel-credentials.service` loads + **decrypts** a provider's per-account
  credentials (from the Day 5 encrypted `ChannelCredential`) and the framework
  injects them into `verifyWebhookChallenge` / `validateWebhookSignature` /
  `parseWebhook` / `sendMessage` / `checkConnection` — **only** for providers
  that set `requiresCredentials`. Web Chat / fake are byte-for-byte unaffected.

This is the pattern every future credentialed provider (Messenger, Instagram,
Telegram) reuses.

### Provider design (`providers/whatsapp/`)

`WhatsAppChannelProvider` implements the standard interface:

- **Webhook verification** — Meta's GET `hub.mode`/`hub.verify_token`/
  `hub.challenge` handshake, checked against the account's encrypted verify token.
- **Signatures** — `X-Hub-Signature-256` HMAC-SHA256 over the raw body using the
  account's App Secret, constant-time compared.
- **Parsing** — `parseWebhook` is fully defensive: it normalizes inbound **text**
  → `incoming_message`; **statuses** → `delivery_status` / `read_receipt`; and
  **media / location / interactive / reactions / unknown types / unknown
  statuses / malformed or future-shaped payloads** → `unsupported` or `[]`. It
  **never throws**, so a new Meta field can never crash the webhook.
- **Sending** — `sendMessage` calls the Graph API (`{version}/{phone_number_id}/
  messages`) via an **injectable transport** (tests never hit the network),
  returning the `wamid` on success.
- **Health** — `checkConnection` reads the phone-number node and maps HTTP
  outcomes to `HEALTHY` / `AUTH_EXPIRED` / `DEGRADED` / `UNAVAILABLE`.
- **Connect** — `prepareConnection` validates the Meta identifiers + secrets and
  splits them into the safe account shape + secret credentials to encrypt.

### Webhook design

Reuses the generic engine: `GET|POST /api/v1/webhooks/whatsapp/:channelAccountId`
(no JWT, dedicated rate limiter). For credentialed providers the engine resolves
the account + decrypts credentials **before** signature validation (the app
secret is per-account); an unknown account or bad signature both return a generic
`401` (no existence leak). Every event is recorded (`ChannelWebhookEvent`) and
**idempotent**: message `wamid` and `wamid:status` are unique per account, so
duplicate / retried / out-of-order Meta deliveries never double-process.

### Incoming & outgoing pipeline (unchanged)

```
Meta → whatsapp provider.parseWebhook → normalizer → channelPipelineService.ingestInbound
     → Customer (channelType WHATSAPP, externalId = wa_id) → Conversation → Message
     → Activity → maybeAutoReply (existing AI)                     [inbound]

Inbox / AI reply → messagesService.send → channelPipelineService.sendOutbound
     → delivery engine → whatsapp provider.sendMessage (Graph API) → SENT + wamid
     → status webhooks (delivered/read/failed) → monotonic delivery updates  [outbound]
```

No duplicated logic, no special cases — the same code Web Chat uses.

### Status mapping

Meta → normalized: `accepted`/`sent` → **SENT**, `delivered` → **DELIVERED**,
`read` → **READ**, `failed` → **FAILED**; `deleted` and any unknown/future status
→ safely **ignored** (recorded as `unsupported`). No architecture change is
needed for new statuses.

### Phone number & Business Account model

**One `ChannelAccount` == one WhatsApp phone number.**
`externalAccountId` = **phone_number_id** (routing key), `externalPageId` =
**WABA id**. A company owns as many accounts (numbers) as it needs; multiple
WABAs and companies are naturally isolated by the tenant-scoped account +
per-account webhook URL + per-account credentials. Connecting the same number
twice is rejected (`409`).

### Security

Access token, app secret, and verify token are **encrypted at rest**
(AES-256-GCM, Day 5 `ChannelCredential`), decrypted only inside the provider,
**never** logged, returned, or exposed to the frontend. Diagnostics and API
responses carry only safe metadata (display number, WABA id, capabilities).

### Health monitoring

The existing health service now probes the real Graph API for WhatsApp: token
validation + API availability → connection state + score, recorded in
`ChannelHealthCheck` history; delivery successes/failures feed the same counters;
the generic **diagnostics** endpoint surfaces it all (no secrets).

### Database changes

**None.** WhatsApp reuses `ChannelAccount` (+ `externalAccountId`/`externalPageId`
mapping), the encrypted `ChannelCredential`, and the delivery / webhook / health /
activity tables. **No migration** was required — a direct demonstration of the
framework's extensibility.

### API routes

```
POST /api/v1/channels/whatsapp/connect      # connect a number (OWNER/ADMIN)
GET|POST /api/v1/webhooks/whatsapp/:id       # Meta webhook (no JWT, signed)
# reused generically: GET /channels, GET /channels/:id, PATCH …/status,
# DELETE …/:id, POST …/health-check, GET …/diagnostics
```

| Action                | OWNER | ADMIN | AGENT |
| --------------------- | :---: | :---: | :---: |
| Connect / disconnect  |  ✅   |  ✅   |  ❌   |
| Health check          |  ✅   |  ✅   |  ❌   |
| View / diagnostics    |  ✅   |  ✅   |  ✅   |
| Meta webhook          |  —    |  —    |  —    | (no JWT; signature required)

### Meta setup (production)

1. Create a Meta app (WhatsApp product) + a Business Account (WABA) and a phone
   number → note the **Phone Number ID** and **WABA ID**.
2. Generate a **System User access token** and copy the **App Secret**; choose a
   **Verify Token** (any strong string).
3. In the dashboard: **Channels → WhatsApp → Connect** and paste those values
   (secrets are encrypted and never shown again).
4. In Meta → WhatsApp → Configuration, set the **Callback URL** to
   `https://YOUR_APP/api/v1/webhooks/whatsapp/<channelAccountId>` and the
   **Verify token** to the same value, then subscribe to the `messages` field.

### Frontend

Channels dashboard: **Connect WhatsApp** modal (Meta identifiers + secrets,
password-masked), WhatsApp account cards showing display number + WABA id +
status + connection health, plus the generic diagnostics, health-check, and
disconnect actions. No secret is ever displayed.

### Configuration

Non-secret global env only (per-account secrets are encrypted, never env):

```
WHATSAPP_API_BASE_URL=https://graph.facebook.com
WHATSAPP_API_VERSION=v21.0
WHATSAPP_REQUEST_TIMEOUT_MS=15000
```

### Tests

38 new tests (**282 total, all passing**): provider registration/capabilities,
webhook verification, signature validation, defensive parsing (text / status /
read / unsupported / unknown / malformed / **future payloads** / duplicate),
status mapping, outbound send with retry classification (401/429/5xx/network),
health (HEALTHY/AUTH_EXPIRED), connect + permissions + **encrypted-at-rest /
no-secret-leak**, incoming pipeline, AI auto-reply, delivery + read callbacks,
idempotency, and cross-tenant isolation. All prior tests still pass.

### Troubleshooting

- **Webhook verification fails** — the Verify Token in Meta must exactly match
  the one entered at connect; the callback URL must include the channel account
  id.
- **401 on webhooks** — the App Secret is wrong (signature mismatch) or the
  account is unknown/disabled.
- **Sends fail with `WA_AUTH` / health `AUTH_EXPIRED`** — the access token is
  invalid/expired; reconnect with a fresh token.
- **429 / 5xx / network** — transient; the delivery engine retries with backoff.

### Known limitations & future architecture

- **Text only.** Media (image/video/audio/file), location, contacts, templates,
  reactions, and interactive messages are **capability-flagged off** and
  normalize to `unsupported` — adding them is **provider-only** work (a
  `sendMedia`/`sendTemplate` path + richer `parseWebhook`), no business-logic
  change.
- **Instagram / Messenger** use the very same Meta webhook + Graph API shape:
  they will reuse this provider's structure (verification, signatures, parsing,
  send, credentials) with different endpoints. **Telegram** reuses the credential
  channel with its own webhook/secret model. All three plug in by registering one
  provider — **no architectural change**.
- No embedded-signup OAuth flow yet (credentials are entered directly); adding it
  is a frontend + connect-hook concern only.

---

## Day 5 Part 3 — Web Chat provider & website widget

Day 5 Part 3 ships the **first real channel provider — Web Chat** — and a
production-quality **website widget**, both built entirely on the Day 5 Part 1/2
framework. Web Chat is the **reference implementation**: WhatsApp, Messenger,
Instagram, and Telegram will later implement only their own webhook parsing,
signature validation, send API, status callbacks, and connection validation —
**no business logic changes**. Those platforms remain **not connected**.

### Conversation flow (uses the existing pipeline — no duplicate logic)

```
Website visitor → Widget (browser)
  → POST /api/v1/widget/:publicId/messages      (public: widget key + session)
  → WebChatProvider.parseWebhook → normalize
  → channelPipelineService.ingestInbound         (find-or-create customer + conversation)
  → maybeAutoReply                                (existing AI pipeline, unchanged)
  → agent/AI reply persisted (Inbox + delivery engine)
  → Widget GET /messages?after=… (poll)          → visitor sees the reply
```

### Web Chat provider (`webchat-channel.provider.ts`)

Implements the standard `ChannelProvider` interface (`developmentOnly: false` —
available in every environment):

- **`parseWebhook`** — the ONLY provider-specific parsing: turns a widget payload
  into a standard `NormalizedIncomingMessageEvent`.
- **`sendMessage`** — Web Chat has no external API; an outbound message is
  persisted by the delivery engine and the widget **polls** it, so send just
  acknowledges (SENT) with a synthetic external id.
- **`checkConnection`** — HEALTHY while the account is enabled.
- **`initializeAccount`** — a new generic provider hook: on account creation it
  mints a **public widget key** (`publicId`) + default widget config. (Signature/
  challenge hooks are inert — the widget authenticates at the session layer.)

### Widget transport (public API — no JWT)

A dedicated `widget` module exposes the browser-facing API. Auth is a **public
widget key** (route) + a **stateless signed session token** (`X-Widget-Session`
header); NO cookies. Mounted in `app.ts` ahead of the global CORS with its own
**permissive, cookie-free CORS** (embeddable on any site) and a dedicated rate
limiter.

```
GET  /api/v1/widget/:publicId/config     # public widget config (no session)
POST /api/v1/widget/:publicId/session    # start/resume — visitor id + history
POST /api/v1/widget/:publicId/messages   # inbound (→ pipeline + AI)
GET  /api/v1/widget/:publicId/messages   # poll agent/AI replies (?after=cursor)
POST /api/v1/widget/:publicId/typing     # typing signal (architecture)
```

- **Visitor identification & persistence.** Anonymous visitors are persisted as
  `Customer` rows (`channelType WEBCHAT`, `externalId = visitorId`). The session
  token encodes the visitor (not a single conversation), so **reconnect after
  refresh** just re-sends the stored token; the conversation is resolved from the
  customer each request (reopen/new handled by the existing pipeline).
- **Session handling** is stateless (HMAC-signed token, `WIDGET_SESSION_SECRET`)
  — no session table. Cross-tenant use is rejected (a token is bound to its
  account + company).
- **Idempotency** via `clientMessageId` (retries/double-submits don't duplicate).

### Website widget (no third-party libraries)

- **`ChatWidget`** — a self-contained React component: floating launcher, open/
  close animation, responsive (desktop/tablet/mobile), unread badge, typing
  indicator, auto-scroll, message timestamps, dark-mode + theme via config,
  localization-ready strings, and a11y (dialog/labels/keyboard). Two modes:
  `standalone` (launcher + panel) and `panel` (iframe body).
- **Public widget page** `/widget/[publicId]` — the iframe target (`?embed=1`)
  and a direct standalone preview.
- **Loader** `public/widget.js` — vanilla JS that injects a host-DOM launcher +
  an iframe panel, syncing open/close, unread badge, and theme via `postMessage`.
- **Reconnect** — the client stores the session token in `localStorage` and
  polls; a refresh resumes the same visitor + history.

Embed snippet (public key — safe to embed):

```html
<script src="https://YOUR_APP/widget.js" data-channel-key="wc_xxx" async></script>
```

### AI integration

Web Chat messages enter the **existing** AI auto-reply pipeline via
`maybeAutoReply` with **no special handling** — subject to the same opt-in gates
(`AI_AUTO_REPLY_ENABLED` + company `autoReplyEnabled` + conversation `aiMode`).
The AI reply is persisted and the widget polls it (shown as the "Assistant").

### Database changes (migration `add_webchat_provider`)

Additive only: `ChannelAccount.publicId` (`String? @unique`) — the public widget
key. Web Chat visitors, conversations, and messages reuse the existing
`Customer` / `Conversation` / `Message` tables (`channelType WEBCHAT`). No new
tables (sessions are stateless).

### API routes & role matrix

Authenticated (dashboard):

```
GET   /api/v1/channels/:id/widget-config    # view config  (all roles)
PATCH /api/v1/channels/:id/widget-config    # edit config  (OWNER/ADMIN)
```

Public widget API (no JWT) as listed above. Creating a Web Chat channel uses the
existing `POST /api/v1/channels` (OWNER/ADMIN) — `initializeAccount` mints the
widget key automatically. Credentials are never involved (Web Chat has none).

### Frontend pages

- `/dashboard/channels` — Web Chat now shows as an available provider with a
  **Configure widget** action per account.
- `/dashboard/channels/webchat/[id]` — config page: form, **live theme preview**
  (light/dark), generated **embed snippet** + copy, install instructions, and an
  "Open live preview" link.
- `/widget/[publicId]` — the public widget (iframe target + standalone preview).

### Configuration

Safe config only (`metadata.webchat`): `title`, `welcomeMessage`, `themeColor`,
`position`, `locale`, `launcherText`, `agentLabel`, `assistantLabel`. New env:
`WIDGET_SESSION_SECRET` (≥32 chars), `WIDGET_SESSION_TTL_MS` (default 30d),
`WIDGET_RATE_LIMIT_WINDOW_MS` / `WIDGET_RATE_LIMIT_MAX`.

### Tests

20 new tests (**243 total, all passing**): Web Chat provider (capabilities,
parse, send, health, initializeAccount), channel creation + widget-config
permissions, public config, session start/reconnect/persistence, inbound through
the shared pipeline, idempotency, agent-reply polling, **AI auto-reply**
integration, invalid/missing session, and cross-tenant isolation.

### Troubleshooting

- **Widget shows "Connection problem"** — ensure `WIDGET_SESSION_SECRET` is set
  (≥32 chars) and the Web Chat channel is enabled.
- **CORS errors embedding on another site** — the widget API reflects any origin
  (cookie-free); make sure the snippet's `src` points at this app's origin.
- **No AI reply** — AI auto-reply is opt-in: `AI_AUTO_REPLY_ENABLED=true`, the
  company's `autoReplyEnabled` setting on, and the conversation `aiMode` ENABLED.

### Preparation for WhatsApp (Day 6)

A future WhatsApp provider implements the **same** `ChannelProvider` interface —
only `parseWebhook`, `validateWebhookSignature`, `sendMessage` (Graph API),
delivery status callbacks, and `checkConnection` differ. It registers once in the
registry; the webhook engine, pipeline, delivery engine, retry, health, Inbox,
and AI all work unchanged. **No WhatsApp / Meta API / OAuth is implemented here.**

### Known limitations

- Live updates use **HTTP polling** (no WebSockets/SSE) — replies appear within
  the poll interval. Typing is architecture-only (no real-time push to the Inbox
  yet).
- AI auto-reply is awaited on the inbound POST (deterministic; ~provider latency).
- Real WhatsApp / Messenger / Instagram / Telegram are still **not connected**.

---

## Day 5 Part 2 — delivery engine & health monitoring

Day 5 Part 2 turns the Part 1 foundation into a **production-grade message
delivery engine**: failures, retries, delivery tracking, and provider health —
all still fully **provider-independent** (no `if channel === "X"` anywhere).
Real providers remain **not connected**; everything is exercised through the
development fake provider. There is **no Redis / BullMQ / worker** — the engine
is *queue-ready*, exposing the exact entry points a Part 3 worker will call.

### Delivery engine

`channel-delivery.service.ts` is the central, provider-independent engine that
owns the outbound lifecycle. The outgoing pipeline delegates its provider path to
it:

```
dispatchOutbound → persist Message (PENDING) + ChannelDelivery (QUEUED)
attemptDelivery  → claim (QUEUED→SENDING, atomic) → provider.sendMessage
                 → success | scheduleRetry | finalizeFailure | expire
```

- **Atomic claim.** `claimDeliveryForAttempt` flips `QUEUED/PENDING → SENDING`
  with a guarded `updateMany`; a return count of 0 means another caller/worker
  already took it — no double-sends.
- **Provider call outside transactions.** The network call never holds a DB
  transaction open; the outcome is persisted atomically afterward.
- **Every attempt recorded** in `ChannelDeliveryAttempt` (retry history) with
  latency, outcome, and a safe error summary.

### Delivery status lifecycle

`ChannelDeliveryStatus` now covers the full lifecycle:
`PENDING` (legacy) · `QUEUED` · `SENDING` · `SENT` · `DELIVERED` · `READ` ·
`FAILED` · `EXPIRED` · `CANCELLED` · `UNKNOWN`. Providers map their own statuses
into these; the fake provider does so today.

### Retry strategy

`channel-retry.service.ts` — a pure, configurable policy (no queue):

- **Exponential backoff + jitter:** `delay = base · factor^(attempt-1)`, capped
  at `maxMs`, with proportional jitter to avoid thundering herds.
- **Max attempts, eligibility rules:** temporary failures retry until
  `maxAttempts`; **permanent** failures never retry.
- **Retry scheduling metadata** on the delivery: `attemptCount`, `maxAttempts`,
  `nextAttemptAt`, `lastAttemptAt`, `failureType`, `expiresAt`.
- **Retry history + reasons** in `ChannelDeliveryAttempt` and
  `DELIVERY_RETRY_SCHEDULED` activity.

Permanent vs temporary is decided from the provider result
(`retryable`, `failureCode`) — a thrown exception is treated as transient.

### Idempotency & failure recovery

- **Outbound:** one delivery per message via a unique `(companyId,
  idempotencyKey = out-<messageId>)`.
- **Status callbacks:** `applyExternalStatus` is **monotonic** — it only advances
  the happy path (`SENT→DELIVERED→READ`), ignores duplicate / out-of-order / late
  callbacks and multiple acknowledgements, and never resurrects a terminal
  delivery.
- **Race conditions:** the atomic claim guards concurrent attempts.
- **Crash recovery:** `recoverStuckDeliveries` re-queues deliveries stuck in
  `SENDING` past a threshold (safe because the claim guarantees no double-send).
- **TTL expiry:** deliveries older than `CHANNEL_DELIVERY_TTL_MS` become
  `EXPIRED` instead of retrying forever.
- **Manual retry:** an admin recovery action re-queues a `FAILED` delivery.

Recovery never duplicates a customer message — inbound idempotency
(`companyId, externalMessageId`) and the per-message delivery key both hold.

### Channel health monitoring

`channel-health.service.ts` folds two signals — manual probes and real delivery
outcomes — into one model:

- **Health score** (0–100): `+20` per success, `−30` per failure, deriving a
  connection state (`HEALTHY ≥ 70`, `DEGRADED ≥ 30`, else `UNAVAILABLE`).
- **Counters:** `successCount`, `failureCount`, `consecutiveFailures`,
  `lastSuccessfulDeliveryAt`, `lastFailedDeliveryAt`.
- **History:** append-only `ChannelHealthCheck` samples (MANUAL / DELIVERY).
- **Degradation & recovery detection:** healthy→unhealthy logs `CHANNEL_DEGRADED`;
  unhealthy→healthy logs `CHANNEL_RECOVERED` (a fresh `UNKNOWN` start never
  false-triggers either).
- **Diagnostics endpoint:** safe monitoring bundle (score, counters, history,
  delivery metrics, retry stats, recent failures, recent recoveries) — **no
  credentials, ever**.

### API additions

```
GET  /api/v1/channels/:id/diagnostics                     # monitoring (all roles)
POST /api/v1/channels/:id/deliveries/:deliveryId/retry    # manual retry (OWNER/ADMIN)
```

`POST /api/v1/channels/:id/health-check` (Part 1) now also records a health
sample and updates the score. Webhook `delivery`/`read` events flow through the
monotonic `applyExternalStatus`.

| Action                     | OWNER | ADMIN | AGENT |
| -------------------------- | :---: | :---: | :---: |
| View diagnostics           |  ✅   |  ✅   |  ✅   |
| Manual delivery retry      |  ✅   |  ✅   |  ❌   |
| Run health check           |  ✅   |  ✅   |  ❌   |

### Database changes (migration `add_delivery_engine`)

Additive only — no Day 1–5.1 data touched, no previous migration modified.

- **`ChannelDelivery`** gains: `attemptCount`, `maxAttempts`, `failureType`,
  `lastAttemptAt`, `nextAttemptAt`, `expiresAt`, `idempotencyKey`
  (unique per company), plus `@@index([status, nextAttemptAt])`.
- **`ChannelAccount`** gains: `healthScore`, `successCount`, `failureCount`,
  `consecutiveFailures`, `lastSuccessfulDeliveryAt`, `lastFailedDeliveryAt`.
- New models: **`ChannelDeliveryAttempt`** (retry history) and
  **`ChannelHealthCheck`** (health history).
- New enums: `ChannelDeliveryFailureType`, `ChannelDeliveryAttemptStatus`,
  `ChannelHealthCheckType`; expanded `ChannelDeliveryStatus` and
  `ChannelActivityType`. (The DB `status` default stays `PENDING` so the
  migration never uses a newly-added enum value in a `DEFAULT` — PostgreSQL
  forbids that in one transaction; the engine sets `QUEUED` explicitly.)

### Environment variables

```
CHANNEL_DELIVERY_MAX_ATTEMPTS=3          # first send + retries
CHANNEL_DELIVERY_BACKOFF_BASE_MS=1000
CHANNEL_DELIVERY_BACKOFF_FACTOR=2
CHANNEL_DELIVERY_BACKOFF_MAX_MS=300000
CHANNEL_DELIVERY_BACKOFF_JITTER=0.2
CHANNEL_DELIVERY_TTL_MS=86400000         # 24h
```

### Frontend

The Channels dashboard gains a **Diagnostics** modal per account (all roles):
health score + connection state, success/failure/consecutive counters, delivery
metrics by status, retry stats, recent failures (with a **Retry** action for
OWNER/ADMIN), recent recoveries, and health-check history. The Inbox keeps its
design and only improves delivery visualization: outbound bubbles now show the
delivery state (queued / sending / sent / delivered / read / failed) and a
`retrying (n/max)` hint while a temporary failure is being re-attempted.

### Tests

35 new tests (**223 total, all passing**): retry policy math + eligibility;
delivery engine (permanent fail, temporary retry, recovery, exhaustion,
`runDueRetries`, crash recovery, manual retry + permissions + tenant isolation);
monotonic/idempotent status callbacks; health monitoring (counters, score,
degradation, diagnostics, tenant isolation, manual probe). All Day 1–5.1 tests
still pass.

### Manual test steps (Day 5 Part 2)

```bash
# With a fake channel + a fake-channel conversation (see Part 1):
# 1. Temporary failure schedules a retry (delivery QUEUED, message PENDING):
#    send a message whose text contains  __RETRY__
# 2. A transient failure that recovers on retry:  __RETRY_OK__
# 3. A permanent failure (no retry, delivery FAILED):  __FAIL__
# 4. Inspect + retry from the dashboard:
curl -s "http://localhost:4000/api/v1/channels/$ACC/diagnostics" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "http://localhost:4000/api/v1/channels/$ACC/deliveries/$DELIVERY/retry" -H "Authorization: Bearer $TOKEN"
```

### Security notes (Day 5 Part 2)

- Diagnostics and delivery records never expose credentials or raw message
  content — only safe summaries and counts.
- Manual retry is OWNER/ADMIN-only and tenant-scoped; cross-tenant returns 404.
- All new tables are tenant-scoped by `companyId`.

### Known limitations & postponed to Part 3

- **No worker / scheduler / queue.** Scheduled retries (`nextAttemptAt`) and
  stuck-delivery recovery are only executed when `runDueRetries` /
  `recoverStuckDeliveries` are called (tests, or a manual retry). Automatic
  execution — Redis, BullMQ, a cron/worker, dead-letter queues — is **Part 3**.
- Real WhatsApp / Instagram / Facebook / Telegram / Web Chat are still **not
  connected**.
- AI-originated outbound messages persist locally (as in Part 1); routing them
  through the delivery engine can be layered on later.

---

## Day 5 Part 1 — channel integration framework

Day 5 Part 1 builds the **reusable foundation** every future social channel will
plug into. The Conversation, Message, Inbox, and AI modules stay
platform-independent — there are **no `if channel === "WHATSAPP"` branches**.
All platform-specific behavior lives inside **channel providers**.

```
External platform
  ↓  Webhook engine (verify + signature, no JWT)
  ↓  Provider adapter  (parse → normalize)
  ↓  Normalized incoming event
  ↓  Channel pipeline  (customer + conversation + message, idempotent)
  ↓  Optional AI auto-reply
  ↓  Channel pipeline  (outgoing)
  ↓  Provider adapter  (send)
  ↓  External platform
```

### Provider interface

Every platform implements one contract
(`modules/channels/providers/channel-provider.interface.ts`):

```ts
interface ChannelProvider {
  readonly key: string;
  readonly channelType: ChannelType;
  readonly capabilities: ChannelCapabilities;
  readonly developmentOnly: boolean;
  verifyWebhookChallenge(input): Promise<WebhookVerificationResult>;
  validateWebhookSignature(input): Promise<boolean>;
  parseWebhook(input): Promise<NormalizedChannelEvent[]>;
  sendMessage(input): Promise<ChannelSendMessageResult>;
  checkConnection?(input): Promise<ChannelConnectionCheckResult>;
}
```

Fully typed, no `any`. Raw provider payloads never leak past `parseWebhook`; the
rest of the app only ever sees normalized, platform-independent types.

### Channel capabilities

A typed capability matrix (`textMessages`, `mediaMessages`, `messageReplies`,
`deliveryReceipts`, `readReceipts`, `typingIndicators`, `reactions`, `templates`,
`customerProfiles`, `webhookVerification`, `webhookSignatures`,
`outboundMessaging`, `inboundMessaging`). Part 1 supports **TEXT** only; every
other capability is `false`. The pipeline and (later) the Inbox gate behavior on
these flags instead of hard-coding platform checks.

### Provider registry

A single registry (`channel-registry.ts`) is the only place providers are
instantiated. It registers/resolves by key, rejects duplicates, returns safe
errors for unknown providers, exposes capabilities, and supports test injection
(`registerOrReplace` / `unregister`). It also publishes an **honest catalog**:
the fake provider is `available: true`; WhatsApp, Instagram, Facebook, Telegram,
and Web Chat are `available: false, comingSoon: true` placeholders — never shown
as connected.

### Normalized events

A discriminated union keeps the boundary clean:

```ts
type NormalizedChannelEvent =
  | NormalizedIncomingMessageEvent   // fully processed in Part 1
  | NormalizedDeliveryStatusEvent    // updates ChannelDelivery
  | NormalizedReadReceiptEvent       // updates ChannelDelivery
  | NormalizedUnsupportedEvent;      // recorded + safely ignored
```

### Webhook engine

Public, **no JWT** (real platforms cannot send bearer tokens). Mounted in
`app.ts` **before** the general API limiter, with its **own** dedicated rate
limiter (separate budget). The raw request body is captured by the JSON parser's
`verify` hook so signatures verify over exact bytes without affecting any other
route.

```
GET  /api/v1/webhooks/:providerKey/:channelAccountId   # verification challenge
POST /api/v1/webhooks/:providerKey/:channelAccountId   # signed event ingest
```

Order of trust: resolve provider → **verify signature before reading the
payload** → resolve the channel account (deriving the tenant from the account,
never from client input) → record the event → normalize → pipeline. Unknown
providers return a generic `404`; unknown/junk account ids return a generic
`200` ack so account existence is never leaked; bad signatures return `403/401`.

### Incoming & outgoing pipelines

One shared pipeline (`channel-pipeline.service.ts`) — the **same** code the
dev-only mock inbound tool now runs through:

- **Incoming**: find-or-create customer → find-or-create/reopen conversation →
  append inbound message → bump unread/timestamps → activity — all atomic and
  **idempotent** on `(companyId, externalMessageId)`. A duplicate event never
  creates a duplicate customer/message and therefore never a duplicate AI reply.
- **Outgoing**: manual/legacy conversations (no channel account) send **locally**
  exactly as in Day 3; conversations bound to an enabled provider are dispatched
  through it, creating a `ChannelDelivery` and recording the transport outcome
  (the provider call runs **outside** any DB transaction).

### Credential encryption

`channel-security.service.ts` uses **AES-256-GCM** (authenticated encryption) via
Node's `crypto` — no custom cryptography. The 32-byte key comes from
`CHANNEL_CREDENTIAL_ENCRYPTION_KEY` (base64). Plaintext is only decrypted inside
backend integration services, never logged, never serialized, and never included
in errors. Stored payload format: `base64(iv).base64(tag).base64(ciphertext)`;
`encryptionVersion` records the scheme for future rotation. The fake provider
needs no credentials, but the abstraction is production-ready and unit-tested.

### Idempotency

Two layers: the webhook event unique key `(channelAccountId, providerKey,
externalEventId)` and the message unique key `(companyId, externalMessageId)`.
Prisma `P2002` races are caught and downgraded to duplicate handling. Different
accounts and different companies may reuse the same external id without
collision.

### Fake / test provider

`fake-channel.provider.ts` (`developmentOnly: true`) exercises the whole
framework with **zero external calls**: challenge verification, HMAC-SHA256
signature validation, deterministic payload parsing, outbound sending with a
`__FAIL__` failure switch, and health checks driven by a `healthSimulation`
metadata field. It is only registered when `FAKE_CHANNEL_ENABLED=true` **and not
in production**, so its public surface can never exist in prod.

Sample inbound webhook body:

```json
{
  "event": "message",
  "eventId": "evt-1",
  "messageId": "msg-1",
  "text": "Hello!",
  "customer": { "id": "cust-1", "name": "Fatima Test" }
}
```

Signature header: `x-fake-signature: <hex HMAC-SHA256(rawBody, FAKE_CHANNEL_WEBHOOK_SECRET)>`.

### Prisma models & enums

New models: **`ChannelAccount`**, **`ChannelCredential`** (encrypted),
**`ChannelWebhookEvent`** (hash + safe summary), **`ChannelDelivery`**,
**`ChannelActivity`** (append-only audit). New enums: `ChannelAccountStatus`,
`ChannelConnectionState`, `ChannelWebhookEventStatus`, `ChannelDeliveryStatus`,
`ChannelActivityType`. `Conversation` gains optional `channelAccountId` +
`providerKey`; `Message` gains a `delivery` back-relation. Every model is
tenant-scoped by `companyId` with company-scoped indexes. Migration:
**`add_channel_framework`** (additive only — no Day 1–4 data touched).

### API routes & role matrix

Authenticated, tenant-scoped:

```
GET    /api/v1/channels                        # list accounts (all roles)
GET    /api/v1/channels/providers              # provider catalog (all roles)
GET    /api/v1/channels/:id                    # account detail (all roles)
POST   /api/v1/channels                        # create        (OWNER/ADMIN)
PATCH  /api/v1/channels/:id                    # edit          (OWNER/ADMIN)
PATCH  /api/v1/channels/:id/status             # enable/disable (OWNER/ADMIN)
DELETE /api/v1/channels/:id                    # soft-disconnect (OWNER/ADMIN)
POST   /api/v1/channels/:id/health-check       # health check  (OWNER/ADMIN)
```

| Action                     | OWNER | ADMIN | AGENT |
| -------------------------- | :---: | :---: | :---: |
| View providers / accounts  |  ✅   |  ✅   |  ✅   |
| Create / edit account      |  ✅   |  ✅   |  ❌   |
| Enable / disable / disconnect | ✅ |  ✅   |  ❌   |
| Run health check           |  ✅   |  ✅   |  ❌   |
| Webhooks (public)          |  —    |  —    |  —    | (no JWT; provider signature required)

Credentials are **never** returned by any endpoint. Client-supplied `companyId`,
sender type, delivery status, and encrypted payloads are all rejected. Creating a
not-yet-available real provider is rejected until its provider class exists; the
fake provider can only be created outside production.

### Frontend Channels page

`/dashboard/channels` (sidebar → **Channels**). Shows provider cards (fake =
"Dev only"; WhatsApp/Instagram/Facebook/Telegram/Web Chat = "Coming soon"), and,
for each connected account: display name, provider, channel type, status,
connection health, enabled/disabled, connected date, last health check, last
safe error summary, and capabilities. Actions (OWNER/ADMIN): add fake channel,
enable/disable, disconnect, run health check. No credential field is ever shown;
the fake webhook secret stays server-side. The Inbox keeps its simplified design
and gains only a lightweight failure indicator on outbound provider messages.

### Manual test steps (Day 5 Part 1)

```bash
# 0. Enable the fake channel in .env (dev only) and restart the backend:
#    FAKE_CHANNEL_ENABLED=true
#    FAKE_CHANNEL_WEBHOOK_SECRET=<hex>   FAKE_CHANNEL_VERIFY_TOKEN=<hex>
#    CHANNEL_CREDENTIAL_ENCRYPTION_KEY=<base64 32 bytes>

# 1. Log in and create a fake channel (OWNER/ADMIN):
curl -s -X POST http://localhost:4000/api/v1/channels \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"providerKey":"fake","displayName":"Fake","externalAccountId":"acct-1"}'
#   -> note the returned account id as $ACC

# 2. Verify the webhook challenge:
curl -s "http://localhost:4000/api/v1/webhooks/fake/$ACC?verify_token=$FAKE_CHANNEL_VERIFY_TOKEN&challenge=ping"
#   -> "ping"

# 3. Send a signed inbound webhook (creates customer + conversation + message):
BODY='{"event":"message","eventId":"e1","messageId":"m1","text":"Hi","customer":{"id":"c1","name":"Fatima"}}'
SIG=$(node -e "console.log(require('crypto').createHmac('sha256',process.env.FAKE_CHANNEL_WEBHOOK_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -X POST "http://localhost:4000/api/v1/webhooks/fake/$ACC" \
  -H 'Content-Type: application/json' -H "x-fake-signature: $SIG" -d "$BODY"

# 4. Re-send the SAME body -> duplicates:1, processed:0 (idempotent, no dupes).
# 5. Reply from the Inbox -> outbound message SENT + a ChannelDelivery row.
# 6. Run a health check from the Channels page -> HEALTHY.
```

### Automated tests

44 new tests (204 total, all passing): provider registry, credential security
(round-trip, random IV, wrong key, tampered ciphertext, no serialization),
channel account CRUD + roles + tenant isolation + no-credential-leak,
webhook verification/signature/unknown-provider/no-account-leak, incoming
pipeline (create/reuse/duplicate/isolation/unsupported/invalid-safe/no-dup-AI),
outgoing pipeline (send/delivery/failure/manual-local/cross-tenant/notes-never-sent),
and channel health (healthy/failure/cross-tenant/AGENT-denied).

### Security notes (Day 5 Part 1)

- Webhook signatures are verified **before** any payload is trusted, over exact
  raw bytes, with constant-time comparison.
- Credentials use authenticated encryption, are never logged/serialized/returned,
  and the encryption key stays backend-only.
- Webhook responses never reveal whether an account id exists.
- The fake provider and its public webhook surface are **disabled in production**.
- Tenant isolation is enforced everywhere; cross-tenant access returns `404`.

### Known limitations & postponed to Part 2

- No real WhatsApp / Instagram / Facebook / Telegram / Web Chat — honest
  placeholders only.
- No retry workers, dead-letter queues, Redis, BullMQ, WebSockets/SSE, media, or
  OAuth connection flows — all **Part 2**.
- Delivery status transitions rely on inbound provider events; the fake provider
  sends immediately (SENT). AI auto-reply persists locally; provider dispatch for
  AI-originated messages can be layered on in Part 2.

---

## Day 4 — AI response engine

Day 4 adds a production-oriented AI assistant built on the **OpenAI API**. The AI
only ever uses the authenticated company's own data, all calls happen on the
backend, and the platform runs fully with AI turned off.

### OpenAI setup (API key vs ChatGPT subscription)

This uses the **OpenAI API** (billed per token via an API key from
<https://platform.openai.com>) — **not** a ChatGPT Plus subscription (that is a
consumer chat product with no programmatic key). Set the key at the **server**
level only; it is never exposed to the frontend or returned by any endpoint.

```env
AI_FEATURE_ENABLED=true          # off by default
AI_AUTO_REPLY_ENABLED=false      # global gate for auto-reply (per-company opt-in also required)
OPENAI_API_KEY=sk-...            # REQUIRED when AI_FEATURE_ENABLED=true (except in tests)
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=30000
OPENAI_MAX_OUTPUT_TOKENS=500
OPENAI_MAX_RETRIES=2
OPENAI_TEMPERATURE=0.3
AI_CONTEXT_MAX_CHARACTERS=30000
AI_CONVERSATION_HISTORY_LIMIT=12
AI_DAILY_COMPANY_REQUEST_LIMIT=1000
AI_MONTHLY_COMPANY_TOKEN_LIMIT=1000000
AI_RATE_LIMIT_WINDOW_MS=60000
AI_RATE_LIMIT_MAX=30
```

- **AI disabled + no key** → starts normally (all Day 1–3 features work).
- **AI enabled + no key** → **fails clearly at startup** (validated in `env.ts`).
- **AI enabled + key** → AI features active.
- In automated tests the provider is always mocked — the real API is never called.

### AI provider architecture

An abstraction (`AIProvider`) isolates the model vendor. `OpenAIProvider` uses
the **Responses API** (`responses.create`): platform + company rules go in
`instructions` (trusted) and conversation turns in `input` (untrusted) — they are
never concatenated. Adding another provider means implementing one interface.
Provider errors map to typed `AIError`s (disabled, not-configured, timeout,
rate-limited, auth-failed, invalid-response, unavailable, quota-exceeded) →
safe HTTP responses; keys/internals/stack traces are never leaked.

### Context building & retrieval (keyword MVP — not vector search)

For each generation a dedicated context service assembles **only the
authenticated company's ACTIVE data**: profile, business hours (for timing
questions), matching services/FAQs/knowledge, recent conversation history, and
the current customer message. Retrieval is **deterministic keyword search over
PostgreSQL** (tokenize → case-insensitive `contains` across the right columns →
lightweight term-overlap ranking → limit → general fallback). It is documented
as keyword-based; **embeddings / vector DB are intentionally not implemented
yet**, and the service is shaped so they can be added later. Context is capped at
`AI_CONTEXT_MAX_CHARACTERS`; internal notes are **never** sent to the AI.

### Prompt safety & injection resistance

Platform safety rules come first and cannot be overridden by company config or
customer text. Customer messages are delimited as untrusted `user` turns and are
never interpolated into system instructions. Common injection attempts ("ignore
previous instructions", "reveal your system prompt", "print the API key", "show
another company's data") are detected and add a safety reminder (and can force
handoff). This reduces risk — it does **not** make injection impossible.

### AI generation modes

| Mode | Endpoint | Roles | Effect |
| --- | --- | --- | --- |
| **Draft** | `POST /conversations/:id/ai/draft` | OWNER, ADMIN, AGENT | Generates draft text; inserted into the composer; **no message created** |
| **Regenerate** | `POST /conversations/:id/ai/regenerate` | OWNER, ADMIN, AGENT | Re-draft with a fixed adjustment (shorter/friendlier/more_formal/arabic/english) |
| **Direct reply** | `POST /conversations/:id/ai/reply` | OWNER, ADMIN | Generates AND stores an OUTBOUND `senderType=AI` message |
| **Auto-reply** | (mock inbound) | system | Auto-answers new inbound when opted in (see below) |
| **Playground** | `POST /ai/playground` | OWNER, ADMIN | Test answer, saved as `PLAYGROUND`, no customer message |

**Draft vs direct reply**: a reviewed draft the employee edits and sends is
stored as an **AGENT** message (the human owns it). Only the direct-reply
endpoint stores a message as **AI** — so authorship is never mislabeled.

### Auto-reply (mock inbound)

Runs synchronously **after** the inbound message commits, only when: AI enabled +
`AI_AUTO_REPLY_ENABLED` + company `autoReplyEnabled` + conversation `aiMode=ENABLED`
+ within quota + not a handoff request. Provider/quota failure **never** rolls
back the inbound message (recorded as a FAILED generation). Idempotent on
`(companyId, externalMessageId)` — a duplicate mock/webhook retry creates neither
a duplicate inbound nor a duplicate AI reply. (No Redis/queue on Day 4 — a strict
synchronous timeout is used; documented.)

### Human handoff & AI modes

`Conversation.aiMode` ∈ `ENABLED | PAUSED | HUMAN_ONLY`. Agents can pause;
OWNER/ADMIN resume. A customer message like "I want to speak to a human" pauses
AI, records `handoffRequestedAt`, and logs an activity. Auto-reply never runs in
PAUSED/HUMAN_ONLY. `PATCH /conversations/:id/ai-mode` changes it.

### Usage, cost & quotas

Every successful provider call records tokens + latency and increments an atomic
per-company/day aggregate (`AIUsageDaily`, unique `companyId+date`). Cost is
**estimated** from a single centralized versioned price table
(`ai.pricing.ts`) — clearly labeled, not the final invoice. Quotas
(`AI_DAILY_COMPANY_REQUEST_LIMIT`, `AI_MONTHLY_COMPANY_TOKEN_LIMIT`) are checked
**before** any provider call; when exceeded a safe 429 is returned, no tokens are
spent, the inbound message is preserved, and manual replies still work.

### AI API routes

| Method | Path | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/conversations/:id/ai/draft` | OWNER, ADMIN, AGENT |
| `POST` | `/api/v1/conversations/:id/ai/regenerate` | OWNER, ADMIN, AGENT |
| `POST` | `/api/v1/conversations/:id/ai/reply` | OWNER, ADMIN |
| `PATCH` | `/api/v1/conversations/:id/ai-mode` | all (resume = OWNER/ADMIN) |
| `GET` | `/api/v1/ai/usage` | all |
| `GET` | `/api/v1/ai/generations` | all |
| `GET` | `/api/v1/ai/generations/:generationId` | all |
| `POST` | `/api/v1/ai/playground` | OWNER, ADMIN |

All require auth, validate UUIDs, derive `companyId` from the JWT, scope every
query by company, use the standard envelope + request IDs, are rate-limited by a
dedicated AI limiter, and never accept a client-supplied companyId, model,
provider, token limit, sender type, or system prompt.

### Inbox message-history fix (cursor pagination)

**Root cause**: the message list returned page 1 = the **oldest** `limit`
messages (ascending + offset), so opening a conversation with more than `limit`
messages showed the oldest and hid the newest. **Fix**: cursor pagination — the
default request returns the **latest** page (newest at the bottom); `?before=<id>`
loads older pages. Ordering is `(createdAt, id)` for stable, gap-free, duplicate-
free paging even with equal timestamps. The frontend `MessageThread` jumps to the
newest on open, preserves scroll when older messages are prepended, shows a "New
messages" button when scrolled up, and each panel scrolls independently with the
composer fixed.

### AI Playground & Inbox controls

- **`/dashboard/ai-playground`** (OWNER/ADMIN): test any question against current
  company knowledge; shows response, model, tokens, estimated cost, latency,
  context-source counts, fallback/handoff flags. Saved as `PLAYGROUND`.
- **Inbox**: "Generate AI draft" / "Regenerate" (tone menu) / "Send AI reply
  directly" (OWNER/ADMIN) near the composer; AI mode selector + handoff banner;
  AI messages are visually distinct; "AI can make mistakes" reminder.

### Known limitations (Day 4)

- **Keyword retrieval only** — no embeddings/vector search yet.
- **No real social channels/webhooks** (WhatsApp/Instagram/Facebook/Telegram),
  no Redis/queues, no WebSockets/SSE, no billing, no file/image/audio.
- Auto-reply is synchronous (no queue); fine for the mock flow, to be moved to a
  worker when real channels arrive.
- Estimated cost ≠ provider invoice.

---

## Day 3 — inbox & conversations

Day 3 adds a unified **Inbox** so a company user can manage customer
conversations. All data is isolated by `companyId`, always derived from the JWT.

### Feature summary

| Feature | Description |
| --- | --- |
| Customers | CRUD (no physical delete), search, channel filter, pagination |
| Conversations | List with rich filters, detail, status/priority/assignment/archive/read |
| Messages | List (paginated) + manual outbound replies (transactional) |
| Internal notes | Team-only notes, author/role-based edit & delete |
| Tags | Global tag catalog (OWNER/ADMIN) + attach/detach on conversations |
| Assignment | Assign to active company users; agents self-assign only |
| Activity | Append-only audit trail per conversation |
| Mock inbound | Dev-only endpoint simulating a channel message (idempotent) |

### The "Too Many Requests" (429) fix

**Root cause.** The `/api/v1/auth/refresh` route shared the **strict auth
limiter** (`AUTH_RATE_LIMIT_MAX`, previously **10** / 15 min). The frontend
calls refresh on every mount, React Strict Mode double-invokes it in dev, every
cross-origin request adds a counted **OPTIONS preflight**, and concurrent 401s
each fired their own refresh (no single-flight). A few page loads exhausted the
tiny 10-request budget → 429. Docker port publishing also makes all browser
requests share one source IP (one rate-limit key), amplifying it.

**Fix (backend).**
- A **dedicated refresh limiter** (`REFRESH_RATE_LIMIT_*`, default 60 / 60s),
  separate from login/register.
- Raised general (`500`) and auth (`20`) limits to realistic values.
- The limiter factory now **skips OPTIONS** (CORS preflight) and **skips
  `/health`** probes so neither consumes quota.
- 429s use the standard API error envelope and include `Retry-After` +
  `RateLimit-*` headers.

**Fix (frontend).** The API client now uses a **single-flight refresh**:
concurrent 401s share one in-flight `/auth/refresh` promise; the refreshed
request retries **once**; the refresh call never triggers another refresh; a
failed refresh clears auth state and redirects to login exactly once. Mutations
are never silently retried beyond the single post-refresh replay.

Configure via env (see `.env.example`):

```env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
REFRESH_RATE_LIMIT_WINDOW_MS=60000
REFRESH_RATE_LIMIT_MAX=60
```

### New database models & enums

Migration **`20260718121935_add_conversations_and_messages`** (Day 1 & Day 2
tables unchanged; only new relations added to `Company`/`User`).

- **`Customer`** — `externalId?`, `channelType`, name/phone/email/username,
  `metadata` (JSON), `firstSeenAt`/`lastSeenAt`. Unique
  `(companyId, channelType, externalId)`; null externalId allowed for manual
  customers.
- **`Conversation`** — `customerId`, `channelType`, `status`, `priority`,
  `assignedUserId?`, `subject?`, last-message timestamps, `unreadCount`,
  `isArchived`, `resolvedAt?`/`closedAt?`. Indexed on companyId + status /
  assignee / lastMessageAt / priority / customerId.
- **`Message`** — `direction`, `senderType`, `contentType` (TEXT only),
  `content`, `status`, `externalMessageId?`, `replyToMessageId?`, timestamps.
  Unique `(companyId, externalMessageId)` for idempotency.
- **`InternalNote`** — team-only notes (`authorUserId`, `content`).
- **`ConversationTag`** — global tag (`name` unique per company, optional hex
  `color`) + **`ConversationTagAssignment`** join (compound PK).
- **`ConversationActivity`** — append-only audit (`activityType`,
  `previousValue`/`newValue`/`metadata` JSON).

Enums: `ChannelType` (WHATSAPP, INSTAGRAM, FACEBOOK, TELEGRAM, WEBCHAT, EMAIL,
MANUAL), `ConversationStatus` (OPEN, PENDING, RESOLVED, CLOSED),
`ConversationPriority` (LOW, NORMAL, HIGH, URGENT), `MessageDirection`
(INBOUND, OUTBOUND), `MessageSenderType` (CUSTOMER, AGENT, SYSTEM, AI — AI
reserved, never generated in Day 3), `MessageStatus` (PENDING, SENT, DELIVERED,
READ, FAILED, RECEIVED), `MessageContentType` (TEXT), `ActivityType`.

### Role matrix (Day 3)

| Action | OWNER | ADMIN | AGENT |
| --- | :---: | :---: | :---: |
| View customers / conversations / messages / notes / tags / activity | ✅ | ✅ | ✅ |
| Create / update customers | ✅ | ✅ | ❌ |
| Create manual conversation | ✅ | ✅ | ❌ |
| Send replies · add notes · update status/priority | ✅ | ✅ | ✅ |
| Assign conversations | ✅ (anyone) | ✅ (anyone) | ✅ (self only) |
| Archive conversations | ✅ | ✅ | ❌ |
| Edit/delete **any** note | ✅ | ✅ | ❌ (own only) |
| Create/update/delete global tags | ✅ | ✅ | ❌ |
| Attach/detach existing tags | ✅ | ✅ | ✅ |

### Multi-tenant security & idempotency

- Every query is scoped by `companyId` from the JWT (reads via
  `findFirst({ where: { id, companyId } })`; writes via `updateMany`/`deleteMany`
  scoped by `{ id, companyId }`). Cross-tenant access returns **404**, never
  revealing existence. Nested entities are scoped by both parent id and company.
- Clients can never send `companyId`, `senderUserId`, `direction`, `senderType`,
  or `status` — all derived server-side. Strict Zod schemas reject unknown fields.
- **Idempotency**: mock inbound is keyed on `(companyId, externalMessageId)` via
  a DB unique constraint. Re-submitting the same external message id returns the
  existing message (`idempotent: true`) without creating a duplicate or
  double-incrementing unread. Prepares the schema for real webhook retries.

### Conversation business rules

- **Inbound** (mock): find-or-create customer → find active conversation or
  create one → append `RECEIVED` message → `unreadCount++`, update
  `lastInboundMessageAt`/`lastMessageAt`, bump customer `lastSeenAt`, and
  **reopen** a RESOLVED/CLOSED conversation to OPEN. Records activity.
- **Outbound** (agent reply): `SENT` message, updates
  `lastOutboundMessageAt`/`lastMessageAt`, never touches unread. Records activity.
- **Mark read** (`PATCH …/read`): sets `unreadCount` to 0 (backend is source of
  truth; the UI marks read once on open).
- **Status timestamps**: OPEN clears resolved/closed; RESOLVED sets `resolvedAt`;
  CLOSED sets `closedAt`; PENDING preserves. All in a transaction with activity.
- All multi-record operations (create conversation + message + activity, send,
  assign, note, status, tag, mock inbound) run inside Prisma transactions.

### Inbox frontend

Route `/dashboard/inbox` — a three-panel desktop layout (**Conversation list |
Message thread | Customer/Notes/Activity**) that stacks on mobile. Components:
`ConversationList`/`ConversationListItem`/`ConversationFilters`,
`ConversationHeader` with `Status`/`Priority`/`Assignment`/`Tag` selectors,
`MessageThread`/`MessageBubble`/`MessageComposer` (Enter to send, Shift+Enter for
newline, character count), `CustomerDetails`, `InternalNotesPanel` (visually
distinct amber notes), `ActivityTimeline`, `NewConversationModal`, and the
dev-only `MockInboundForm` (`/dashboard/dev/mock-message`). Search is debounced,
stale list responses are ignored, and there is a manual **Refresh** button (no
polling, no sockets in Day 3).

### Day 3 manual test checklist

1. `docker compose up --build`; seed: `docker compose exec backend npm run prisma:seed`.
2. Log in (`owner@demo.com` / `Demo12345`) → open **Inbox** — no 429, seeded
   conversations appear.
3. Filters (status/priority/assignment/channel/tag/unread/archived) + search work.
4. Open a conversation → messages load, unread badge clears (mark read).
5. Send a reply (Enter to send); it appears and updates the list preview.
6. Add / edit / delete an internal note (Notes tab); notes never appear in the thread.
7. Change status, priority, assignment; attach/detach tags — all persist.
8. Archive a conversation.
9. **Mock Message** tool → send an inbound message → a new unread conversation appears.
10. Re-send the same external message id → no duplicate (idempotent).
11. Activity tab shows created/received/sent/status/priority/note/tag events.
12. Log in as `agent@demo.com` → read-only where required (no create-customer,
    no archive, can reply/note/self-assign).
13. Day 1 (login/logout/refresh) and Day 2 (profile/services/…) pages still work.

### Known limitations (Day 3)

- **No AI**: no OpenAI calls, no generated messages (AI sender type reserved only).
- **No real channels/webhooks**: inbound is simulated via the dev-only endpoint,
  which is never mounted in production.
- **TEXT messages only** — no attachments/images/audio/PDF.
- **No Redis, BullMQ, WebSockets, or SSE** — the list has a manual refresh; the
  data model is real-time-ready (unread counts, last-message markers) for a later
  socket/worker layer.
- Message list pagination is page-based ascending (stable id tie-break); "Load
  more" fetches additional pages.

---

## Day 2 — business configuration

Day 2 lets an authenticated **OWNER** or **ADMIN** manage everything the future
AI assistant will need to answer customers. All data is stored in PostgreSQL and
**completely isolated by `companyId`**, which is always derived from the JWT —
never accepted from the request body, URL, or query.

### Feature summary

| Feature | Description |
| --- | --- |
| Company profile | Extended company fields (contact, address, languages, timezone) |
| Services & pricing | CRUD, activate/deactivate, reorder, search/filter/paginate |
| Business hours | Weekly schedule (Mon–Sun) with per-day open/close or closed |
| FAQs | CRUD, categories, activate/deactivate, reorder, search/paginate |
| Knowledge base | CRUD plain-text articles with tags, search, filter, reorder |
| AI settings | Assistant behavior config (tone, language, messages) — **config only** |
| Dashboard | Responsive SaaS dashboard with a page for every feature above |

### New database models

Added in migration **`20260718103459_day2_business_configuration`** (the Day 1
`Company`, `User`, `RefreshToken` models are unchanged except for new **optional**
profile columns on `Company`, all with safe defaults so existing rows keep working):

- **`Company`** (extended) — `displayName`, `description`, `industry`, `email`,
  `phone`, `whatsappNumber`, `websiteUrl`, `address`, `city`, `country`,
  `timezone` (default `Asia/Amman`), `defaultLanguage` (default `ar`),
  `responseLanguage` (default `auto`).
- **`BusinessService`** — `name`, `description?`, `price?` (Decimal), `currency`
  (default `JOD`), `priceType` (enum), `durationMinutes?`, `isActive`,
  `sortOrder`. Unique `(companyId, name)`; indexes on `companyId` and
  `(companyId, isActive)`.
- **`BusinessHour`** — `dayOfWeek` (enum), `isClosed`, `openTime?` / `closeTime?`
  as `"HH:mm"` strings. Unique `(companyId, dayOfWeek)`.
- **`FrequentlyAskedQuestion`** — `question`, `answer`, `category?`, `isActive`,
  `sortOrder`. Indexes on `companyId` and `(companyId, isActive)`.
- **`KnowledgeBaseEntry`** — `title`, `content`, `category?`, `tags` (Postgres
  `String[]`), `isActive`, `sortOrder`.
- **`CompanyAISettings`** — one-to-one with `Company`: `assistantName?`,
  `systemInstructions?`, `replyTone` (enum), `preferredLanguage`,
  `fallbackMessage`, `humanHandoffMessage`, `maxReplyLength?`, `useEmojis`,
  `autoReplyEnabled` (defaults **false**).

New enums: `ServicePriceType` (FIXED, STARTING_FROM, VARIABLE, CONTACT_US, FREE),
`DayOfWeek` (MONDAY…SUNDAY), `ReplyTone` (PROFESSIONAL, FRIENDLY, CASUAL, FORMAL,
CONCISE).

### Authorization matrix

| Action | OWNER | ADMIN | AGENT |
| --- | :---: | :---: | :---: |
| View profile / services / hours / FAQs / KB / AI settings | ✅ | ✅ | ✅ |
| Update company profile | ✅ | ✅ | ❌ |
| Create / update / delete / reorder services | ✅ | ✅ | ❌ |
| Activate / deactivate services | ✅ | ✅ | ❌ |
| Save business hours (full or single day) | ✅ | ✅ | ❌ |
| Create / update / delete / reorder FAQs | ✅ | ✅ | ❌ |
| Create / update / delete / reorder KB entries | ✅ | ✅ | ❌ |
| Update AI settings | ✅ | ✅ | ❌ |

Enforced by `authorizeRoles(UserRole.OWNER, UserRole.ADMIN)` on every write
route. Unauthorized writes return **403** in the standard error format.

### Multi-tenant security

- Every repository query includes `companyId` in its `where` clause — reads use
  `findFirst({ where: { id, companyId } })`; updates/deletes use
  `updateMany` / `deleteMany` scoped by `{ id, companyId }`. There is no
  fetch-by-id-then-check pattern.
- Cross-tenant access returns **404** (never reveals another tenant's record).
- `companyId` is taken only from `req.user` (the verified JWT); clients cannot
  send it. Batch reorder validates that every id belongs to the caller's company
  before running inside a transaction.
- Automated tests create **two companies** and prove records cannot leak between
  them.

### API response format

List endpoints return `{ items, pagination: { page, limit, total, totalPages } }`
inside the standard `data` envelope. Service **prices are serialized as strings**
(or `null`) so clients never receive an unusable Prisma `Decimal` and never lose
precision to floating point.

### Frontend dashboard pages

`/dashboard` (Overview with counts + setup progress), `/dashboard/profile`,
`/dashboard/services`, `/dashboard/business-hours`, `/dashboard/faqs`,
`/dashboard/knowledge-base`, `/dashboard/ai-settings`. All are protected, share a
responsive sidebar/header shell with a mobile drawer, and disable write controls
for AGENT users. Toast notifications, loading skeletons, empty states, and
delete confirmations are used throughout.

### Example requests

```bash
# Log in and capture the access token
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.com","password":"Demo12345"}' | jq -r .data.accessToken)

# Update the company profile (partial)
curl -X PATCH localhost:4000/api/v1/company/profile \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"displayName":"Acme Rockets","city":"Amman"}'

# Create a service
curl -X POST localhost:4000/api/v1/services \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Consultation","priceType":"FIXED","price":25,"currency":"JOD","durationMinutes":30}'

# Save the full weekly schedule
curl -X PUT localhost:4000/api/v1/business-hours \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"hours":[{"dayOfWeek":"SUNDAY","isClosed":false,"openTime":"09:00","closeTime":"18:00"},{"dayOfWeek":"FRIDAY","isClosed":true,"openTime":null,"closeTime":null}]}'

# Read the dashboard overview
curl localhost:4000/api/v1/overview -H "Authorization: Bearer $TOKEN"
```

### Day 2 manual test checklist

1. `docker compose up --build`, then seed: `docker compose exec backend npm run prisma:seed`.
2. Log in at <http://localhost:3000/login> as `owner@demo.com` / `Demo12345`.
3. **Overview** shows counts and setup progress.
4. **Company Profile** loads values, saves a change, shows a success toast, warns on unsaved changes.
5. **Services** — add (price field hides for Contact us/Free/Variable), edit, deactivate, reorder (↑/↓), delete (with confirm), search & filter, paginate.
6. **Business Hours** — toggle days closed/open, times disable when closed, closing-before-opening is rejected, save persists.
7. **FAQs** & **Knowledge Base** — full CRUD, category filter, search, tags (KB).
8. **AI Settings** — shows the "not connected yet" warning, saves via upsert.
9. Log in as `agent@demo.com` — every page is read-only (no write buttons, writes return 403).
10. Restart the stack (`docker compose down && docker compose up`) — data persists.

### Known limitations / postponed to later days

- **No AI**: AI settings are configuration only; no OpenAI call or generated
  replies. `autoReplyEnabled` is stored but does nothing yet.
- **No channels / conversations / messages / customers / webhooks.**
- **No Redis, BullMQ, billing, file uploads, PDF processing, or embeddings.**
- Service/FAQ/KB deletion is a **physical delete** (Day 2 records aren't yet
  referenced by conversations); the `isActive` toggle provides soft
  deactivation. This can migrate to soft-delete when conversations arrive.
- Slug is **not** regenerated when the company `name` changes (stable identifier).

---

## Architecture

**Monorepo** with npm workspaces containing two apps plus a Docker stack.

- **Backend** — Node.js + Express + TypeScript, PostgreSQL via Prisma ORM,
  JWT auth (short-lived access token + rotating refresh token), bcrypt password
  hashing, and Zod for request + environment validation. Clean layered
  architecture: **routes → controllers → services → repositories**. Controllers
  contain no business logic; repositories own all Prisma queries; services hold
  the business rules.
- **Frontend** — Next.js (App Router) + TypeScript + Tailwind CSS. Login,
  register, and a protected dashboard. The access token is kept **in memory
  only**; the refresh token lives in an **httpOnly cookie** (never localStorage).
- **Infrastructure** — Docker Compose with three services: `postgres`,
  `backend`, `frontend`, with health checks, dependency ordering, a persistent
  Postgres volume, and hot reload in development.

### Multi-tenancy model

- Every `User` belongs to a `Company` via `companyId`.
- The first user to register a company automatically becomes its **OWNER**.
- The authenticated company is **always** derived from the JWT identity —
  a `companyId` sent by the client is never trusted. Repositories are designed
  to scope every future record by `companyId`.

### Token strategy

- **Access token** — short-lived JWT (`15m` default), sent as
  `Authorization: Bearer <token>`.
- **Refresh token** — longer-lived JWT (`30d` default). Only a **SHA-256 hash**
  of it is stored in the `refresh_tokens` table. On `POST /auth/refresh` the
  token is **rotated** (old one revoked, new pair issued). Logout revokes it.
  Delivered to browsers via an httpOnly cookie.

---

## Folder structure

```text
ai-support-platform/
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Company, User, RefreshToken models
│   │   │   ├── migrations/          # committed SQL migrations
│   │   │   └── seed.ts              # demo company + owner
│   │   ├── src/
│   │   │   ├── config/              # env (Zod), prisma client, cors
│   │   │   ├── controllers/         # thin controllers (aggregation barrel)
│   │   │   ├── middlewares/         # auth, validate, error, 404, reqId, logger, rate limit
│   │   │   ├── modules/
│   │   │   │   ├── auth/            # controller, service, repository, routes, validation, types
│   │   │   │   ├── companies/       # repository + service (tenant-scoped)
│   │   │   │   └── users/           # repository + service (tenant-scoped)
│   │   │   ├── repositories/        # Prisma-query layer (aggregation barrel)
│   │   │   ├── routes/              # /api/v1 router + health routes
│   │   │   ├── services/            # business logic (aggregation barrel)
│   │   │   ├── types/               # Express request augmentation
│   │   │   ├── utils/               # AppError, apiResponse, jwt, password, slug, cookies…
│   │   │   ├── validations/         # shared Zod building blocks
│   │   │   ├── app.ts               # Express app assembly
│   │   │   └── server.ts            # bootstrap + graceful shutdown
│   │   ├── tests/                   # Jest + Supertest suite
│   │   └── Dockerfile
│   └── frontend/
│       ├── src/
│       │   ├── app/                 # login, register, dashboard (App Router)
│       │   ├── components/          # small UI primitives
│       │   └── lib/                 # api client, auth context, types
│       └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json                    # workspace root + scripts
└── README.md
```

---

## Prerequisites

- **Docker** + **Docker Compose** (for the Docker workflow), **or**
- **Node.js ≥ 20** and a local/remote **PostgreSQL** (for the non-Docker workflow).

---

## Quick start (Docker)

```bash
# 1. Copy env and set strong JWT secrets
cp .env.example .env
#   Generate secrets:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   Paste distinct values into JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.

# 2. Build and start everything
docker compose up --build
```

Then open:

- Frontend → <http://localhost:3000>
- Backend  → <http://localhost:4000>
- Postgres → `localhost:5433` (host) / `postgres:5432` (inside the network)

Migrations run automatically inside the backend container on startup
(`prisma migrate deploy` — it **applies** committed migrations and **never**
resets your data). The Postgres volume persists across restarts.

To seed demo data into the running stack:

```bash
docker compose exec backend npm run prisma:seed
```

Stop the stack (data is kept):

```bash
docker compose down
```

---

## Local development (without Docker)

```bash
# Start only Postgres (exposed on 5433 to avoid clashing with a local install)
docker compose up -d postgres

# Backend
cp apps/backend/.env.example apps/backend/.env      # adjust secrets
npm install
npm run prisma:migrate:dev -w apps/backend          # create/apply migrations
npm run prisma:seed -w apps/backend                 # optional demo data
npm run dev -w apps/backend                          # http://localhost:4000

# Frontend (in another terminal)
cp apps/frontend/.env.example apps/frontend/.env.local
npm run dev -w apps/frontend                          # http://localhost:3000
```

Or run both together from the repo root:

```bash
npm run dev
```

---

## Environment variables

Copy `.env.example` → `.env` (root, used by Docker Compose). Key variables:

| Variable | Description | Example |
| --- | --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` | `development` |
| `BACKEND_PORT` | Backend HTTP port | `4000` |
| `FRONTEND_PORT` | Frontend HTTP port | `3000` |
| `NEXT_PUBLIC_API_URL` | Browser-facing backend URL | `http://localhost:4000` |
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@postgres:5432/ai_support?schema=public` |
| `POSTGRES_DB/USER/PASSWORD` | Postgres container credentials | `ai_support` / `postgres` / `postgres` |
| `POSTGRES_HOST_PORT` | Host port mapped to Postgres | `5433` |
| `JWT_ACCESS_SECRET` | Access-token secret (≥ 32 chars) | *generate* |
| `JWT_REFRESH_SECRET` | Refresh-token secret (≥ 32 chars, ≠ access) | *generate* |
| `JWT_ACCESS_EXPIRES_IN` | Access-token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token lifetime | `30d` |
| `COOKIE_SECURE` | Set `true` in production (HTTPS) | `false` |
| `COOKIE_SAME_SITE` | `lax` \| `strict` \| `none` | `lax` |
| `CORS_ORIGINS` | Comma-separated allowlist | `http://localhost:3000` |
| `BCRYPT_SALT_ROUNDS` | bcrypt cost factor | `12` |
| `JSON_BODY_LIMIT` | Max JSON request body | `100kb` |
| `RATE_LIMIT_*` | Global API rate limit window/max | `900000` / `500` |
| `AUTH_RATE_LIMIT_*` | Login/register rate limit window/max | `900000` / `20` |
| `REFRESH_RATE_LIMIT_*` | Token-refresh rate limit window/max | `60000` / `60` |
| `AI_FEATURE_ENABLED` | Master AI on/off (key required when true) | `false` |
| `AI_AUTO_REPLY_ENABLED` | Global auto-reply gate (per-company opt-in too) | `false` |
| `OPENAI_API_KEY` | OpenAI API key — server-side only, never exposed | *(unset)* |
| `OPENAI_MODEL` | Model id | `gpt-4o-mini` |
| `AI_*` / `OPENAI_*` | Timeouts, token/temperature, context, history, quotas, AI rate limit | see `.env.example` |
| `CHANNEL_CREDENTIAL_ENCRYPTION_KEY` | Base64 32-byte AES-256-GCM key (backend-only) | *generate* |
| `CHANNEL_CREDENTIAL_ENCRYPTION_VERSION` | Credential encryption scheme version | `v1` |
| `WEBHOOK_RATE_LIMIT_*` | Public webhook rate limit window/max (separate budget) | `60000` / `300` |
| `FAKE_CHANNEL_ENABLED` | Dev fake channel on/off (never active in production) | `false` |
| `FAKE_CHANNEL_WEBHOOK_SECRET` | Fake provider HMAC secret — server-side only | *(unset)* |
| `FAKE_CHANNEL_VERIFY_TOKEN` | Fake provider verification token — server-side only | *(unset)* |
| `CHANNEL_DELIVERY_MAX_ATTEMPTS` | Delivery attempts before permanent failure | `3` |
| `CHANNEL_DELIVERY_BACKOFF_*` | Retry backoff base/factor/max (ms) + jitter | `1000` / `2` / `300000` / `0.2` |
| `CHANNEL_DELIVERY_TTL_MS` | Delivery lifetime before EXPIRED | `86400000` |
| `WIDGET_SESSION_SECRET` | Signs Web Chat session tokens (≥32 chars, backend-only) | *generate* |
| `WIDGET_SESSION_TTL_MS` | Widget visitor reconnect window | `2592000000` |
| `WIDGET_RATE_LIMIT_*` | Public widget API rate limit window/max | `60000` / `240` |
| `WHATSAPP_API_BASE_URL` | Meta Graph API base (non-secret) | `https://graph.facebook.com` |
| `WHATSAPP_API_VERSION` | Graph API version | `v21.0` |
| `WHATSAPP_REQUEST_TIMEOUT_MS` | Graph API request timeout | `15000` |

The backend validates all of these at startup (Zod) and exits with a clear
message if anything is missing or invalid.

---

## Database & migrations

```bash
# Create a new migration during development (also applies it)
npm run prisma:migrate:dev -w apps/backend

# Apply committed migrations without prompting (used in containers/CI)
npm run prisma:migrate -w apps/backend        # prisma migrate deploy

# Regenerate the Prisma client after schema changes
npm run prisma:generate -w apps/backend
```

Models: `Company`, `User`, `RefreshToken` (Day 1); `BusinessService`,
`BusinessHour`, `FrequentlyAskedQuestion`, `KnowledgeBaseEntry`,
`CompanyAISettings` (Day 2); `Customer`, `Conversation`, `Message`,
`InternalNote`, `ConversationTag`(+assignment), `ConversationActivity` (Day 3);
**`AIResponseGeneration`, `AIUsageDaily`** (Day 4, plus AI-mode/handoff
columns on `Conversation`); and **`ChannelAccount`, `ChannelCredential`,
`ChannelWebhookEvent`, `ChannelDelivery`, `ChannelActivity`** (Day 5 Part 1, plus
optional `channelAccountId`/`providerKey` on `Conversation`); and
**`ChannelDeliveryAttempt`, `ChannelHealthCheck`** (Day 5 Part 2, plus retry
metadata on `ChannelDelivery` and health counters on `ChannelAccount`); and a
public `publicId` widget key on `ChannelAccount` (Day 5 Part 3 — Web Chat reuses
`Customer`/`Conversation`/`Message` with `channelType WEBCHAT`). **Day 6 (WhatsApp)
added NO models** — it reuses `ChannelAccount` (externalAccountId = phone_number_id,
externalPageId = WABA id), the encrypted `ChannelCredential`, and the
delivery/webhook/health tables. New Day 4
enums: `AIConversationMode`, `AIGenerationType`, `AIGenerationStatus`; Day 5
enums: `ChannelAccountStatus`, `ChannelConnectionState`,
`ChannelWebhookEventStatus`, `ChannelDeliveryStatus`, `ChannelActivityType`,
`ChannelDeliveryFailureType`, `ChannelDeliveryAttemptStatus`,
`ChannelHealthCheckType`. See
[`apps/backend/prisma/schema.prisma`](apps/backend/prisma/schema.prisma).
Migrations are committed under `apps/backend/prisma/migrations/`; `migrate
deploy` applies them without ever resetting data. Migrations to date: `…_init`,
`…_day2_business_configuration`, `…_add_conversations_and_messages`,
`…_add_ai_generation_and_usage`, `…_add_channel_framework`,
`…_add_delivery_engine`, `…_add_webchat_provider`.

---

## Seeding

```bash
npm run prisma:seed -w apps/backend
# or inside Docker:
docker compose exec backend npm run prisma:seed
```

The seed is **idempotent** (safe to run repeatedly — no duplicate rows) and
**refuses to run when `NODE_ENV=production`**. It creates one demo company with a
full profile, owner/admin/agent users, 3 services, 7 business-hour rows, 3 FAQs,
3 knowledge-base entries, and default AI settings.

---

## Testing

The suite uses **Jest + Supertest** and runs against a **separate test
database** (`TEST_DATABASE_URL`, defaults to `ai_support_test` on port 5433).

```bash
# 1. Ensure Postgres is running and the test DB exists + is migrated
docker compose up -d postgres
docker compose exec postgres psql -U postgres -c "CREATE DATABASE ai_support_test;"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/ai_support_test?schema=public" \
  npm run prisma:migrate -w apps/backend   # apply schema to the test DB

# 2. Run the tests
npm run test
```

Covered: health endpoint, registration, duplicate-email rejection, login
success, invalid login, protected `/auth/me`, refresh + rotation/reuse, logout
revocation, and validation failures.

---

## Available scripts

Run from the repo root (delegates to the workspaces):

| Command | Description |
| --- | --- |
| `npm run dev` | Run backend + frontend together (hot reload) |
| `npm run build` | Build backend and frontend |
| `npm run lint` | Lint both apps |
| `npm run format` | Prettier-format both apps |
| `npm run test` | Run backend tests |
| `npm run prisma:migrate` | Apply committed migrations (deploy) |
| `npm run prisma:seed` | Seed demo data |

Docker equivalents:

| Command | Description |
| --- | --- |
| `docker compose up --build` | Build + start the whole stack |
| `docker compose down` | Stop the stack (keeps the data volume) |
| `docker compose exec backend npm run prisma:seed` | Seed inside the container |
| `docker compose exec backend npm run test` | Run tests inside the container |
| `docker compose logs -f backend` | Tail backend logs |

---

## API endpoints

Base path: `/api/v1`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Liveness (top-level, unthrottled) |
| `GET` | `/api/v1/health` | – | Readiness — verifies DB connectivity |
| `POST` | `/api/v1/auth/register` | – | Register a company + owner, returns tokens |
| `POST` | `/api/v1/auth/login` | – | Log in with email + password |
| `POST` | `/api/v1/auth/refresh` | cookie/body | Rotate refresh token, issue a new pair |
| `POST` | `/api/v1/auth/logout` | cookie/body | Revoke the refresh token |
| `GET` | `/api/v1/auth/me` | Bearer | Current user + company (protected) |

**Day 2** (all require a Bearer access token; writes require OWNER/ADMIN):

| Method | Path | Roles | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/overview` | all | Dashboard counts + setup progress |
| `GET` | `/api/v1/company/profile` | all | Get company profile |
| `PATCH` | `/api/v1/company/profile` | OWNER, ADMIN | Partial profile update |
| `GET` | `/api/v1/services` | all | List (search, isActive, sortBy, page, limit) |
| `POST` | `/api/v1/services` | OWNER, ADMIN | Create service |
| `GET` | `/api/v1/services/:serviceId` | all | Get one service |
| `PATCH` | `/api/v1/services/:serviceId` | OWNER, ADMIN | Update service |
| `DELETE` | `/api/v1/services/:serviceId` | OWNER, ADMIN | Delete service |
| `PATCH` | `/api/v1/services/:serviceId/status` | OWNER, ADMIN | Activate/deactivate |
| `PATCH` | `/api/v1/services/reorder` | OWNER, ADMIN | Batch reorder (transaction) |
| `GET` | `/api/v1/business-hours` | all | Full weekly schedule (7 days) |
| `PUT` | `/api/v1/business-hours` | OWNER, ADMIN | Upsert full schedule |
| `PATCH` | `/api/v1/business-hours/:dayOfWeek` | OWNER, ADMIN | Upsert one day |
| `GET` | `/api/v1/faqs` | all | List (search, category, isActive, page, limit) |
| `POST` | `/api/v1/faqs` | OWNER, ADMIN | Create FAQ |
| `GET` | `/api/v1/faqs/:faqId` | all | Get one FAQ |
| `PATCH` | `/api/v1/faqs/:faqId` | OWNER, ADMIN | Update FAQ |
| `DELETE` | `/api/v1/faqs/:faqId` | OWNER, ADMIN | Delete FAQ |
| `PATCH` | `/api/v1/faqs/:faqId/status` | OWNER, ADMIN | Activate/deactivate |
| `PATCH` | `/api/v1/faqs/reorder` | OWNER, ADMIN | Batch reorder |
| `GET` | `/api/v1/knowledge-base` | all | List (search, category, tag, isActive, page) |
| `POST` | `/api/v1/knowledge-base` | OWNER, ADMIN | Create entry |
| `GET` | `/api/v1/knowledge-base/:entryId` | all | Get one entry |
| `PATCH` | `/api/v1/knowledge-base/:entryId` | OWNER, ADMIN | Update entry |
| `DELETE` | `/api/v1/knowledge-base/:entryId` | OWNER, ADMIN | Delete entry |
| `PATCH` | `/api/v1/knowledge-base/:entryId/status` | OWNER, ADMIN | Activate/deactivate |
| `PATCH` | `/api/v1/knowledge-base/reorder` | OWNER, ADMIN | Batch reorder |
| `GET` | `/api/v1/ai-settings` | all | Get settings (defaults if none) |
| `PUT` | `/api/v1/ai-settings` | OWNER, ADMIN | Upsert settings |

**Day 3** (all require a Bearer access token):

| Method | Path | Roles | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/customers` | all | List (search, channelType, page, limit, sort) |
| `POST` | `/api/v1/customers` | OWNER, ADMIN | Create customer |
| `GET` | `/api/v1/customers/:customerId` | all | Get one customer |
| `PATCH` | `/api/v1/customers/:customerId` | OWNER, ADMIN | Update customer |
| `GET` | `/api/v1/customers/:customerId/conversations` | all | Customer's conversations |
| `GET` | `/api/v1/conversations` | all | List (status, priority, assignee, unassigned, channel, tag, unread, archived, search, page) |
| `POST` | `/api/v1/conversations` | OWNER, ADMIN | Create manual conversation |
| `GET` | `/api/v1/conversations/:id` | all | Conversation detail |
| `PATCH` | `/api/v1/conversations/:id` | OWNER, ADMIN | Update subject |
| `PATCH` | `/api/v1/conversations/:id/status` | all | Change status |
| `PATCH` | `/api/v1/conversations/:id/priority` | all | Change priority |
| `PATCH` | `/api/v1/conversations/:id/assignment` | all* | Assign (agents: self only) |
| `PATCH` | `/api/v1/conversations/:id/archive` | OWNER, ADMIN | Archive/unarchive |
| `PATCH` | `/api/v1/conversations/:id/read` | all | Mark read (unread → 0) |
| `GET` | `/api/v1/conversations/:id/activity` | all | Activity/audit timeline |
| `GET` | `/api/v1/conversations/:id/messages` | all | List messages (paginated) |
| `POST` | `/api/v1/conversations/:id/messages` | all | Send outbound reply |
| `GET` | `/api/v1/conversations/:id/notes` | all | List internal notes |
| `POST` | `/api/v1/conversations/:id/notes` | all | Add note |
| `PATCH` | `/api/v1/conversations/:id/notes/:noteId` | all* | Edit note (own; OWNER/ADMIN any) |
| `DELETE` | `/api/v1/conversations/:id/notes/:noteId` | all* | Delete note (own; OWNER/ADMIN any) |
| `POST` | `/api/v1/conversations/:id/tags/:tagId` | all | Attach tag |
| `DELETE` | `/api/v1/conversations/:id/tags/:tagId` | all | Detach tag |
| `GET` | `/api/v1/conversation-tags` | all | List global tags |
| `POST` | `/api/v1/conversation-tags` | OWNER, ADMIN | Create tag |
| `PATCH` | `/api/v1/conversation-tags/:tagId` | OWNER, ADMIN | Update tag |
| `DELETE` | `/api/v1/conversation-tags/:tagId` | OWNER, ADMIN | Delete tag (+ assignments) |
| `GET` | `/api/v1/users/assignable` | all | Active company users for assignment |
| `POST` | `/api/v1/dev/mock-inbound-message` | all | **Dev only** — simulate inbound message |

**Success response**

```json
{ "success": true, "message": "Operation completed successfully", "data": {} }
```

**Error response**

```json
{
  "success": false,
  "message": "Readable error message",
  "errors": [{ "field": "email", "message": "..." }],
  "requestId": "uuid"
}
```

Example register request:

```json
{
  "companyName": "ABC Company",
  "fullName": "Omar Ahmad",
  "email": "owner@example.com",
  "password": "StrongPassword123!"
}
```

---

## Demo credentials

After seeding (all share the password `Demo12345`):

```text
Owner:  owner@demo.com  / Demo12345
Admin:  admin@demo.com  / Demo12345
Agent:  agent@demo.com  / Demo12345   (read-only — for testing role restrictions)
```

The demo company is seeded with a full profile, 3 services, a 7-day schedule,
3 FAQs, 3 knowledge-base entries, and default AI settings.

---

## Security notes

- Helmet security headers, CORS allowlist from env, and rate limiting on all API
  routes with stricter limits on auth endpoints.
- Passwords hashed with bcrypt; refresh tokens hashed (SHA-256) before storage
  and rotated on every refresh.
- JWT secrets validated at startup (length + must differ). No secrets are
  committed — `.env` is gitignored.
- Max JSON body size enforced; graceful shutdown on SIGINT/SIGTERM.
- Stack traces are never returned in production responses.

---

## Troubleshooting

- **Port 5432/5433 already in use** — a local Postgres is running. This project
  maps the container to host port **5433** by default; change
  `POSTGRES_HOST_PORT` in `.env` if 5433 is also taken.
- **Backend exits with "Invalid environment configuration"** — set
  `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (≥ 32 chars, different values) in
  `.env`.
- **CORS errors in the browser** — ensure the frontend origin is in
  `CORS_ORIGINS` and `NEXT_PUBLIC_API_URL` points to the backend.
- **`prisma migrate deploy` finds no migrations** — run
  `npm run prisma:migrate:dev -w apps/backend` once to create the initial
  migration (already committed in this repo).
- **Prisma client out of date after schema edits** — run
  `npm run prisma:generate -w apps/backend`.
- **Refresh returns 401 after login** — the refresh cookie is scoped to
  `/api/v1/auth`; make sure requests use `credentials: 'include'` (the bundled
  API client already does).
- **Tests fail to connect** — create and migrate `ai_support_test` (see
  [Testing](#testing)); never point `TEST_DATABASE_URL` at your dev database.
```
