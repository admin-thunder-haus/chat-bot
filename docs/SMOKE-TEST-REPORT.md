# Production Smoke Test Report

## Environment

| | |
|---|---|
| **Frontend URL** | ⚠️ **none — the frontend is not deployed.** Tested locally (`localhost:3100`) against a local backend. |
| **Backend URL** | https://ai-support-backend-hpub.onrender.com (Render **Starter**) |
| **Database** | Neon Postgres (production) |
| **Date** | 2026-07-27 |
| **Commit under test** | `a0c6d82` (live in Render during the run) → `1fc94ec` after the fix below |
| **Tester** | Claude (automated, driving the real production API) |
| **Test tenant** | `ZZ SMOKE TEST smoke1 (delete me)` / `ahmdjmhawy65+smoke1@gmail.com` — created for this run, **deleted at the end as test 13b** |

A Gmail `+alias` was used deliberately so real mail landed in a real inbox instead of hard-bouncing.

---

## Results

### 1. Cold start — **PASS**

`/health` five consecutive times: **0.758s, 0.600s, 0.568s, 0.600s, 0.594s** — all under 1s.

```json
{"success":true,"message":"Service is healthy","data":{"status":"ok","uptime":68137.08}}
```

`/api/v1/health` (with a DB round-trip): `{"status":"ok","database":"up"}` in **0.554s**.

**Evidence the sleep problem is gone:** `uptime` was **68,137s ≈ 19 hours**. The instance had not restarted or slept, which is the actual thing the "leave it idle 20 minutes" step was probing for. The Starter upgrade did what it was supposed to.

### 2. Registration — **PASS**

| Step | Result |
|---|---|
| `POST /auth/register` | `201`, `requiresEmailVerification: true` |
| User row created, unverified | ✅ |
| `email.send` job | `SUCCEEDED`, attempts=1, no error — **SMTP genuinely accepted it** |
| `POST /auth/verify-email` | `200`, access token issued |
| User now verified | ✅ |
| `GET /auth/me` with that token | `200` |

The 6-digit code was recovered by brute-forcing its SHA-256 hash (10⁶ candidates) so the **real** code-entry path was exercised end-to-end rather than simulated. That shortcut only exists because the code is 6 digits — which is exactly why the password-reset token is 256-bit instead.

### 3. Forgot / reset password — **PASS** (11/11)

| Check | Expected | Actual |
|---|---|---|
| `forgot-password` | 200 generic | ✅ 200, "If an account with this email exists…" |
| Reset email sent | job SUCCEEDED | ✅ `kind=password-reset`, no error |
| Token row issued | yes | ✅ |
| Mismatched confirmation | 400 | ✅ |
| Weak password | 400 | ✅ |
| Valid token | 200 | ✅ |
| **Token reuse** | 400 | ✅ single-use holds |
| **Old password** | 401 | ✅ |
| New password | 200 | ✅ |
| **Pre-reset sessions revoked** | 0 active | ✅ 0 |
| Expired token | 400 | ✅ |
| Unknown email | same generic 200 | ✅ no enumeration |

**Caveat, stated honestly:** the reset token is 256-bit and only its hash is stored, so it cannot be recovered from the database. This test **injected** a token whose plaintext it knew and then drove the real endpoint. Everything after the link click is genuinely covered. The one thing not covered is the URL inside the email body — **the owner should click the real link once** to close that gap.

### 4. Legal pages — **PASS**

Both `/privacy` and `/terms` return `200`. **Zero** `[ FILL IN` placeholders, **zero** warning banners.

| Variable | Rendered value |
|---|---|
| `LEGAL_ENTITY_NAME` | Thunder Haus Solutions |
| `LEGAL_ENTITY_ADDRESS` | Amman, Jordan |
| `LEGAL_CONTACT_EMAIL` | dev@thunder-haus.com |
| `LEGAL_DATA_RETENTION` | 30 days |
| `LEGAL_JURISDICTION` | laws of Jordan |

### 5. Connect a channel — **PASS (Web Chat)** / Telegram + WhatsApp **BLOCKED**

`POST /api/v1/channels` (`webchat`) → `201`, `status=CONNECTED`, `connectionState=HEALTHY`, appears in the channel list.

**Not tested:** Telegram (no bot token available to the tester) and WhatsApp (number not registered — see Blockers). Web Chat rides the *same* shared pipeline — normalizer → inbound pipeline → conversation → outbound delivery — so everything except the provider-specific HTTP transport is genuinely covered.

### 6. Receive a message — **PASS**

Visitor session opened via the public widget API, message posted (`201`), and it appeared in the agent inbox in **~5.1 seconds**. Conversation, customer and message rows all created; thread read back as `INBOUND/CUSTOMER: "Hello, what are your opening hours"`.

### 7. Human reply — **PASS**

Agent reply `201` → visitor polled and **received it**. Delivery row status `SENT` (not a silent fake).

### 8. AI auto-reply — **PASS**

Auto-reply enabled (`200`). Visitor asked *"What kind of bread do you sell?"*:

> **"We sell sourdough bread at ZZ Smoke Bakery."**

Generation rows `COMPLETED`. It used the configured company profile (name + description) — **grounded, not generic**.

### 9. PDF knowledge base — **PASS**

Uploaded a one-page PDF containing a unique invented fact. Status went `PROCESSING → READY` (1 chunk, 1 page, 83 chars extracted). Then asked a question answerable *only* from that document:

> **"The secret warranty policy code is WRT-848609 and it covers 37 months."**

Both the unique code and the 37-month figure came back correctly. (The code matches the first of two PDFs uploaded during the run — an artefact of my retry, not of retrieval.)

### 10. Product image — **PASS**

Image upload `201`; product created `201` and appears in the list. Fetching the image URL: `200`, `image/png`, **bytes byte-identical to what was uploaded**, and

```
Cross-Origin-Resource-Policy: cross-origin
```

which is the header that makes images render in a browser rather than silently break.

### 11. Mobile 375px — **PASS (local)** / real device **BLOCKED**

All nine pages measure `scrollWidth 375 / clientWidth 375` — **no horizontal scroll anywhere**:

Overview · Inbox · Products · Services · Channels · Company profile · Login · Forgot password · Reset password

Measured headlessly at 375px against a local build. **Not tested on a physical phone.**

### 12. Billing disabled — **PASS**

| Route | Result |
|---|---|
| `GET /billing/subscription` | `410` `BILLING_DISABLED` |
| `GET /billing/plans` | `410` `BILLING_DISABLED` |
| `POST /billing/webhook/stripe` | `410` `BILLING_DISABLED` |

`/auth/me` reports `{"billing":false,"aiActions":true}`, and **0 subscription rows** were created for a tenant that registered, connected a channel, uploaded documents and used AI. Sidebar hiding is driven by that same flag and is covered by unit tests.

### 13. Data export — **PASS**

`200`, `22,636` bytes, `Content-Disposition: attachment; filename="…-export-2026-07-27.json"`, valid JSON with 17 top-level sections: company, users, customers, conversations, messages, services, products, businessHours, faqs, knowledgeBaseEntries, knowledgeDocuments, aiSettings, appointments, orders, supportTickets, channelAccounts, meta.

**Secret scan — clean.** Explicitly searched and *not found*: `passwordHash`, `"password"`, `tokenHash`, `accessToken`, `refreshToken`, `ak_live_`, `apiKey`, `verifyToken`, `signingSecret`. `users[0]` exposes only `id, fullName, email, role, status, emailVerifiedAt, createdAt, updatedAt`. `channelAccounts` carry no credentials. `knowledgeDocuments` carry metadata only, no bytes.

> My first automated scan flagged "credential" — that was a **false positive in my own scanner**. The words appear only inside `meta.excluded`, a self-documenting list of what the export deliberately omits. Good design, bad regex.

---

## Additional verifications

| Item | Status | Evidence |
|---|---|---|
| SMTP sends | **PASS** | 3 separate `email.send` jobs `SUCCEEDED`, attempts=1, no error |
| Sentry receives a test error | **PASS** | `POST /health/test-error` → 500; 2 issues in Sentry; release tagged `a0c6d8248f65` |
| Sentry email notification | **BLOCKED** | Requires the owner's inbox. Dashboard showed **"Create Alert"** — likely **no alert rule exists** |
| Background jobs complete after restart | **PASS** | Planted a job orphaned in `RUNNING` for 1h → worker recovered it → `SUCCEEDED` |
| Retry jobs resume after restart | **PASS** | Forced a delivery to `QUEUED` with a past `nextAttemptAt` → sweeper picked it up → `SENT`, attempts=2 |
| Login audit records logins | **PASS** | 18 rows; `SUCCESS` **and** `INVALID_PASSWORD`, each with IP + user-agent |
| Deletion removes all company records | **PASS** | Walked all **38** `companyId` models via runtime DMMF; **20 held data**, **0 remained** |
| Deletion leaves no storage objects | **PASS (DB mode)** | Image rows and bytes gone. S3 is not configured in production, so the bucket path is **untested in prod** |
| Render env contains required vars | **PASS** | `/health/integrations` → `{"sentry":true,"smtp":true}`; legal, AI, channels, storage all functioning |
| No secrets printed in logs | **PASS** | `requestLogger` emits only requestId, method, path **with query string stripped**, status, duration |
| Frontend production build | **PASS** | 25 routes compiled, 25/25 static pages |
| Backend production build | **PASS** | `tsc -p tsconfig.build.json` clean |
| Backend tests | **PASS** | **69 suites / 771 tests** |
| Frontend tests | **PASS** | **12 files / 79 tests** |
| Playwright e2e | **PASS** | **5/5** specs |

Post-deletion checks: deleted user's access token → `401`; demo tenant untouched.

---

## Bugs found

### BUG 1 — job batch size was not a real limit (**real; fix shipped**)

`runDueJobs(2)` was twice observed reporting **3** claimed jobs. `claimed` is the row count from `claimDue`, so the batch size was bounding nothing.

`claimDue` selected candidates with `IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)`. That reads as equivalent to a CTE but is not: a sub-select may legally be planned as a semi-join and **re-scanned**, and a re-scanned `SKIP LOCKED + LIMIT` can return more than `n` rows. Moved the candidate set into a CTE, which is guaranteed to execute once — the standard Postgres queue pattern.

It matters because this instance runs one small Prisma pool shared with the request path; an unbounded pass can starve inbound webhooks.

**Honest status:** I could **not** reproduce the overrun on demand — 25 rounds × 6 concurrent claimers against 40 due jobs never exceeded the limit, before or after the change. The CTE removes the only mechanism that could produce the observed number, so it is **defence, not a confirmed fix**. The assertion that caught it stays in place; `jobs-queue` then passed 5 consecutive runs plus a full suite.

### BUG 2 — two orphan companies with zero users (**real, unexplained; non-blocking**)

```
[kj-hup]           created 2026-07-26T14:34:36Z  0 conversations  0 channels
[kj-hup-b2cc64]    created 2026-07-26T14:37:07Z  0 conversations  0 channels
```

Both timestamps match the two registrations that failed during the SMTP outage. A company with no users is unreachable — nobody can log in to it.

I could not find a code path that produces this state: registration creates company + user in one transaction, company deletion is a single atomic `company.delete` that cascades users, and **there is no user-delete endpoint at all**. It may be residue from my own cleanup interacting with concurrent manual testing. Both rows are empty and harmless; recommend deleting them and watching for a recurrence.

### Not bugs — my own test-script errors, listed for transparency

Three `400`/mismatch results were **my** mistakes, and the API was right each time: sending `price` as a string when the schema requires a number; sending `visitorName` to a `.strict()` schema expecting `visitor: { name }`; reading `data.conversations` when the API returns `data.items`.

---

## Changes made

| File | Why |
|---|---|
| `apps/backend/src/modules/jobs/jobs.repository.ts` | BUG 1 — `claimDue` now uses a CTE so the batch size is a real bound |
| `apps/frontend/e2e/mobile.spec.ts` | Extended the 375px sweep to `/login`, `/forgot-password`, `/reset-password`. They must be measured **signed out** (all three redirect to `/dashboard` when a session exists), so they are a separate test with its own browser context |
| `docs/SMOKE-TEST-REPORT.md` | This report |

No other production code was touched.

---

## Remaining blockers

### 🔴 1. The frontend is not deployed — the only true launch blocker

There is no customer-facing URL. The dashboard runs on `localhost` against the Render backend. **A paying customer cannot use the product today.** Deploy it (Vercel free tier fits; or a second Render service), then set `CORS_ORIGINS` on the backend to the new origin and `NEXT_PUBLIC_API_URL` on the frontend.

### 🟠 2. WhatsApp cannot send

Outbound still fails with Meta error **133010** (number not registered on Cloud API). Inbound may work; replies will not. See the answer below.

### 🟡 3. Sentry alert rule probably missing

Errors are arriving, but the dashboard showed "Create Alert". Without a rule, failures are recorded and **nobody is told** — which defeats the purpose. Create *"when a new issue is created" → email*, then re-fire `/health/test-error` and confirm the mail arrives.

### 🟡 4. Secrets pasted in chat still need rotating

The Brevo `SMTP_PASS` and `WIDGET_SESSION_SECRET` were shared in screenshots. Rotate both. (The Sentry DSN is low-risk and does not need urgent rotation.)

---

## Final verdict

# NOT READY FOR PRODUCTION

**Not because the software is weak — because customers have no way to reach it.**

The backend is in genuinely good shape. Every critical server-side flow was exercised against real production infrastructure and passed: registration with real email delivery, password reset including session revocation, channel connect, inbound message, human reply, AI auto-reply grounded in the tenant's own data, PDF retrieval, image serving with the correct CORP header, billing correctly disabled, GDPR export with no secret leakage, complete account deletion across all 38 tenant-scoped models, crash recovery, delivery retry, and login auditing. 69/771 backend tests, 12/79 frontend, 5/5 e2e, both builds clean.

One real bug was found and shipped; one anomaly is documented and unexplained.

The single thing standing between this state and a launch is **deploying the frontend**. Once that is done and smoke-tested against the deployed origin — plus the Sentry alert rule and the WhatsApp number registration — this becomes **READY WITH NON-BLOCKING ISSUES**, with the residual gaps being the S3 path (unused), Telegram/WhatsApp transport (untested end-to-end), and lawyer review of the legal text.
