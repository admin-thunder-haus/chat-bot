# Day 12 — Business Platform: Completion Report

Five new subsystems on the existing architecture; zero regressions
(**backend 55 suites / 571 tests**, frontend 20 Vitest tests, both builds
clean). Features "Messenger provider" and "Telegram provider" from the
milestone brief were already delivered in full on Days 8-9 (inbound/outbound,
AI replies, health, diagnostics, webhooks; Day 11 added voice) — verified
green in this run, not rebuilt.

## 1. Embedded Signup / OAuth channel connection

- `modules/channels/oauth/`: Meta OAuth flow — `POST /channels/oauth/meta/start`
  returns a facebook.com dialog URL (Login-for-Business config for
  Messenger/Instagram, Embedded-Signup config for WhatsApp) with an
  HMAC-signed 10-minute state (no server session); the public callback
  verifies state, exchanges the code, discovers assets automatically (first
  Page from `/me/accounts`; WABA via `/debug_token` + first phone number),
  and calls the **existing** connect services with the exact manual-flow
  payloads — credentials stay AES-256-GCM encrypted, webhook subscription
  (`subscribed_apps`) runs automatically. Browser returns to
  `/dashboard/channels?connected=…` (never any token in a URL).
  `POST …/whatsapp/complete` covers the JS-SDK popup variant.
- Env-gated: without `META_APP_ID/SECRET` the buttons hide and manual connect
  remains; with them, manual moves behind "Advanced / manual setup".
  Operator setup guide: `docs/META-OAUTH.md`. Telegram keeps its official
  BotFather flow (token paste; webhook + secret auto-configured since Day 9).

## 2. Billing & subscriptions

- `Plan` (JSON limits map — new limits need no migration) + one
  `Subscription` per company. Catalog: free_trial ($0, 14 days), starter
  $19/$190, pro $49/$490, business $99/$990 (unlimited); seeded idempotently
  at boot + seed script.
- Free trial auto-created at registration (and lazily on first read).
  Upgrades/downgrades immediate; monthly/yearly; cancel/resume
  (cancelAtPeriodEnd); lazy expiry (TRIALING past trial end / ACTIVE past
  period + 3-day grace → EXPIRED) — no cron needed.
- Limits enforced at the seams: AI generation (monthly request cap +
  EXPIRED blocks AI with `SUBSCRIPTION_EXPIRED`), channel connect
  (maxChannels), knowledge-document upload (maxDocuments); all violations
  return 403 `PLAN_LIMIT_REACHED`.
- Payments: provider abstraction with a Stripe implementation (raw
  form-encoded API calls, injectable transport, signature-verified webhook
  `POST /billing/webhook/stripe`). Without `STRIPE_SECRET_KEY` the system
  runs in offline mode (plan changes apply directly) — the current
  deployment default.
- `/dashboard/billing`: plan/status card, six usage bars, plan grid with
  cycle toggle (OWNER-only changes, checkout redirect when Stripe is on).

## 3. Notifications

- Central `emitDomainEvent()` (`modules/events/`) fans out to BOTH
  consumers, each isolated and non-fatal.
- In-app: `Notification` rows (company-wide or user-targeted), endpoints
  list/unread-count/mark-read/read-all; header bell with 30s unread polling
  and dropdown. Email: users with matching roles get mail via the existing
  mailer (silent no-op until SMTP is configured).
- Wired events: new conversation, human handoff (emails OWNER/ADMIN),
  failed AI reply, subscription events (emails OWNER), AI write-actions
  (SYSTEM_ALERT), plus webhook-only conversation.resolved / customer.created
  / action.executed.

## 4. Public API & outbound webhooks

- API keys: `ak_live_<32hex>` shown once, stored as SHA-256 hash; scopes;
  revoke; lastUsedAt. Public surface `/api/public/v1` (own mount + rate
  limiter): `GET /me`, `/conversations`, `/conversations/:id` (+messages),
  `/customers` — strictly scoped to the key's tenant.
- Outbound webhooks: per-company URL + event subscription; signing secret
  shown once and stored encrypted; deliveries POSTed with
  `X-Webhook-Signature: sha256=<HMAC>` + `X-Webhook-Event`, 3 attempts,
  delivery log, failure counter with auto-disable at 20 consecutive
  failures. `/dashboard/integrations` manages both. Docs:
  `docs/PUBLIC-API.md` (auth, endpoints, signature verification sample,
  event catalog).

## 5. AI Actions

- Plug-in `ActionHandler` registry (key, description, Zod input schema,
  execute) — new actions register without touching the pipeline. Built-ins:
  `book_appointment`, `create_order` (name→product resolution, Decimal
  totals, no partial orders), `create_support_ticket`,
  `check_product_availability` (read-only).
- Protocol mirrors the handoff sentinel: when actions are allowed
  (auto-reply + agent reply-and-send; `AI_ACTIONS_ENABLED`), the prompt
  advertises the catalog and the model answers `ACTION_REQUEST {json}`;
  the platform parses tolerantly, validates with Zod (invalid → 'rejected'
  audit + clarifying question built from the Zod issues — no extra AI
  call), executes (audit 'completed'/'failed'), emits `action.executed`,
  notifies the team, and sends the customer a confirmation through the
  normal delivery pipeline. Read-only lookups feed ONE follow-up generation
  for a natural answer; hard cap 1 action per inbound message.
- New records: Appointment / Order+items / SupportTicket / AIActionExecution
  with management endpoints and the `/dashboard/operations` page
  (Appointments / Orders / Tickets / AI Activity tabs).

## Database (migration `day12_business_platform`)

plans, subscriptions, notifications, api_keys, outbound_webhooks,
outbound_webhook_deliveries, appointments, orders, order_items,
support_tickets, ai_action_executions + enums. All additive; applied by
Render on deploy.

## Env additions (all optional / defaulted)

META_APP_ID, META_APP_SECRET, META_GRAPH_API_VERSION, WHATSAPP_ES_CONFIG_ID,
META_LOGIN_CONFIG_ID, FRONTEND_APP_URL, BILLING_TRIAL_DAYS,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AI_ACTIONS_ENABLED.

## Verification

- Backend: tsc, eslint, **55 suites / 571 tests** (69 new across
  meta-oauth 17, billing 16, notifications+public-api 25, ai-actions 11),
  production build.
- Frontend: typecheck, lint, 20 Vitest tests, production build (new routes
  /dashboard/billing, /dashboard/integrations, /dashboard/operations).
- Production smoke test after deploy: see commit notes.

## Manual verification steps

1. Register a company → Billing shows a 14-day trial with usage bars.
2. Channels → with META_* configured, "Connect with Meta" completes in the
   popup; without, manual connect unchanged.
3. Send a widget message → bell shows a NEW_CONVERSATION notification.
4. Ask the bot "احجز موعد بكرة الساعة 3" → appointment appears under
   Operations with an AI confirmation reply and an AI Activity row.
5. Integrations → create an API key, `curl -H "Authorization: Bearer ak_live_…"
   …/api/public/v1/conversations`; add a webhook and watch delivery dots.

## Extensibility

New plan = DB row. New limit = JSON key + one assert call. New notification
or webhook event = one `emitDomainEvent` call. New AI action = one handler
file + registry line. New payment provider = one class behind the interface.
