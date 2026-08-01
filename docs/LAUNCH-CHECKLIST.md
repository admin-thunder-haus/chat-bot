# Launch checklist — everything you must do by hand

This is the operator's list. The code is done; these are the things only you can
do, because they need your accounts, your money and your business details.

**How to read it.** Part 1 must be finished before you charge the first paying
customer. Part 2 can wait until you have customers. Part 3 is a 10-minute smoke
test to run on launch day. Each item says why it matters, what it costs and
roughly how long it takes.

Total for Part 1: about **2–3 hours of clicking** and **$7/month**.

> Anything in `CODE FONT` is an environment variable name. On Render you set
> those under **your service → Environment → Add Environment Variable**, then
> click **Save, rebuild, and deploy**. Every save triggers a redeploy (~3 min),
> so it is faster to add several at once and save one time.

---

## Part 1 — before the first paying customer

### 1.1 Upgrade Render from Free to Starter — $7/month, 5 minutes

**Why this is first.** The free instance **sleeps after 15 minutes of no
traffic**. The next request has to start the whole app, which takes around
**40 seconds**. That breaks you in three ways:

- **Meta will mark your webhook endpoint as failing.** WhatsApp, Instagram and
  Messenger expect a fast response. Enough slow or timed-out deliveries and Meta
  disables your webhook subscription — you stop receiving customer messages and
  nobody tells you.
- Every background loop stops while the instance is asleep, so a message
  waiting on a retry sits there until someone happens to visit the site.
- The first customer of the morning waits 40 seconds for a reply.

**Do it:**

1. Open <https://dashboard.render.com> and sign in.
2. Click the **ai-support-backend** service.
3. In the left sidebar click **Settings**.
4. Scroll to **Instance Type** and click **Change Instance Type**.
5. Pick **Starter — $7/month**. Confirm.
6. Wait for the service to redeploy (about 3 minutes).

**Verify it worked:** leave the app alone for 20 minutes, then open
<https://ai-support-backend-hpub.onrender.com/health> in a browser. It must
answer **immediately** (under a second) with `{"status":"ok",...}`. If it takes
30+ seconds, the upgrade did not apply — check the Instance Type again.

---

### 1.2 Configure SMTP so emails actually send — free, 20 minutes

**Why it matters.** Right now `SMTP_HOST` is unset, so the app **logs emails
instead of sending them**. That means:

- a new customer never receives their verification code and cannot log in;
- **"Forgot password" silently does nothing** — the user is locked out for good;
- you never get the notification emails when a channel breaks.

Nothing about this is visible in the UI. It looks like it worked.

Pick **one** of the two options.

#### Option A — Brevo (recommended: 300 emails/day free, proper deliverability)

1. Sign up at <https://www.brevo.com> (free "Starter" plan, no card).
2. Confirm your own email, then complete the short "what will you send"
   onboarding.
3. Go to **Senders, Domains & Dedicated IPs → Senders** and click **Add a
   sender**. Use an address on a domain you control. Confirm the email Brevo
   sends you.
4. Go to your avatar (top right) → **SMTP & API** → the **SMTP** tab.
5. Copy the **SMTP server**, **Port**, **Login** and **Master password** shown
   there. The master password is the SMTP key — treat it as a secret.
6. In Render → Environment, add:

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | the Brevo SMTP login |
   | `SMTP_PASS` | the Brevo master password |
   | `EMAIL_FROM` | `Your Business <hello@yourdomain.com>` (must be the sender you verified) |

7. Save and let it redeploy.

**Also do this, or your mail lands in spam:** in Brevo, open **Senders, Domains
& Dedicated IPs → Domains**, add your domain, and add the **SPF** and **DKIM**
DNS records it gives you at your domain registrar. This is the single biggest
factor in whether verification emails arrive.

#### Option B — Gmail App Password (fastest, fine for the first few customers)

Gmail limits you to roughly 500 emails/day and mail comes from your Gmail
address, which looks less professional.

1. Your Google account must have 2-Step Verification enabled
   (<https://myaccount.google.com/security>).
2. Go to <https://myaccount.google.com/apppasswords>, create a password named
   `AI Support`, and copy the 16-character value.
3. In Render → Environment, add:

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `false` |
   | `SMTP_USER` | your full Gmail address |
   | `SMTP_PASS` | the 16-character app password (no spaces) |
   | `EMAIL_FROM` | `Your Business <youraddress@gmail.com>` |

**Verify it worked (do this for either option — it is the only real proof):**

1. Register a brand-new account on your app using a **real** email address you
   can open (not one already in the database).
2. The verification code must arrive in that inbox within a minute or two.
   Check spam.
3. Enter the code and confirm you land in the dashboard.
4. Now sign out, click **Forgot password?**, enter that same address, and
   confirm the reset link arrives and works.

If nothing arrives: Render → your service → **Logs**, and search for
`SMTP not configured`. If you see that line, the variables did not take effect —
check for a typo in the variable NAME.

#### The one mistake that breaks everything: `EMAIL_FROM`

`EMAIL_FROM` is **not cosmetic and it is not optional.** Brevo (and SendGrid, and
Gmail) will **reject every single send** whose From address is not a sender you
verified in that account. If you set `SMTP_HOST`/`USER`/`PASS` but leave
`EMAIL_FROM` alone, it keeps its placeholder default `no-reply@localhost`, and
**100% of your emails fail** — no verification codes, no password resets.

This already happened once during testing. The symptoms to recognise:

- the registration request hangs for a long time, then
- returns **Internal Server Error**, and
- retrying the same email says **"An account with this email already exists"**.

The app now guards against all three:

- Startup prints a loud warning if `SMTP_HOST` is set while `EMAIL_FROM` is
  still the default. **Check your Render logs for `⚠️  SMTP_HOST is set but
  EMAIL_FROM is still the default` right after your first deploy.**
- Emails are queued as background jobs, so a rejected send can no longer fail a
  registration or leave an account stranded — it is retried with backoff.
- SMTP now has a 10-second timeout (`SMTP_TIMEOUT_MS`), so a dead relay cannot
  hang a request for minutes.

To confirm a send actually succeeded rather than merely being accepted for
retry, search the Render logs for `email.send` — a `jobs.job.dead` line naming
`email.send` means the relay rejected it every time, and the `lastError` on that
row is the relay's own message (usually "not a verified sender").

---

### 1.3 Create a Sentry project and set `SENTRY_DSN` — free, 10 minutes

**Why it matters.** Without this, a server error at 3am exists only in Render's
log stream, which you will not be reading. With it, you get an email with the
stack trace, the affected company and the request id.

The integration is off until you set the DSN — no DSN means the SDK is never
even loaded.

1. Sign up at <https://sentry.io> (free tier: 5,000 errors/month, no card).
2. Create an organisation when prompted.
3. Click **Create Project**. Platform: **Node.js**. Alert frequency: **Alert me
   on every new issue**. Name it `ai-support-backend`.
4. Sentry shows a setup page with a line like
   `Sentry.init({ dsn: "https://abc123@o456.ingest.sentry.io/789" })`.
   Copy **only the URL inside the quotes** — that is your DSN.
5. In Render → Environment add `SENTRY_DSN` = that URL. Save and redeploy.
6. In Sentry, open **Settings → Alerts** and confirm your email is set to
   receive new-issue notifications.

**Verify it worked — two levels.**

*Level 1: did it start?* Render → **Logs**, search `Sentry`. Exactly one of:

| Log line | Meaning |
|---|---|
| `Sentry error tracking enabled` | ✅ initialised |
| `Sentry is disabled (SENTRY_DSN is not set)` | the variable never arrived |
| `Failed to initialise Sentry` | the DSN is malformed |

Or ask the API, signed in as the OWNER:

```bash
curl -H "Authorization: Bearer <your access token>" \
  https://ai-support-backend-hpub.onrender.com/api/v1/health/integrations
```

It answers `{"sentry":true,"smtp":true}` — booleans only, never a DSN or key.

*Level 2: do errors actually ARRIVE?* Level 1 only proves the SDK started. An
alerting path nobody has ever fired is not an alerting path, so fire it once:

```bash
curl -X POST -H "Authorization: Bearer <your access token>" \
  https://ai-support-backend-hpub.onrender.com/api/v1/health/test-error
```

You get a normal `500` back, and within a minute a Sentry issue titled
**"Sentry verification error triggered deliberately"** appears in **Issues**. If
you get the 500 but no issue, the DSN is wrong or the project is muted — that is
the failure this step exists to catch, and finding it now beats finding it during
your first real outage.

The route is OWNER-only and can do nothing but throw — it touches no data. Run it
whenever you want to re-confirm alerting, e.g. after changing the DSN.

Note: request payloads are scrubbed of passwords, tokens, cookies, API keys and
contact details before being sent, so a Sentry report cannot leak a credential.

Note: request payloads are scrubbed of passwords, tokens, cookies, API keys and
contact details before being sent, so a Sentry report cannot leak a credential.

---

### 1.4 Fill in the legal blanks — free, 30 minutes

**Why it matters.** `/privacy` and `/terms` are the URLs Meta's app reviewer
opens, and the first thing any EU customer asks for. The pages exist and are
written, **but they are a template with deliberate blanks**. Until you fill
them, both pages display a yellow banner saying *"This document is not
finished"* and highlighted `[ FILL IN: … ]` placeholders in the text. That is on
purpose — an unfinished policy should look unfinished rather than quietly ship.

Add these five to Render → Environment:

| Variable | What to put | Example |
|---|---|---|
| `LEGAL_ENTITY_NAME` | The registered name of your business | `Thunder Haus LLC` |
| `LEGAL_ENTITY_ADDRESS` | Your registered business address | `12 Rainbow St, Amman, Jordan` |
| `LEGAL_CONTACT_EMAIL` | Where privacy/data requests go | `privacy@yourdomain.com` |
| `LEGAL_DATA_RETENTION` | How long you keep data after an account closes | `30 days` |
| `LEGAL_JURISDICTION` | Whose law governs the terms | `Jordan` |

Optionally set `LEGAL_LAST_UPDATED` (e.g. `August 2026`) when you next revise
the text.

**Verify it worked:** open
<https://ai-support-backend-hpub.onrender.com/privacy> and
<https://ai-support-backend-hpub.onrender.com/terms>. The yellow banner must be
**gone** and there must be **no** `[ FILL IN` text anywhere on either page. Use
Ctrl+F to check.

> ⚠️ This text is a **template written by an engineer, not a lawyer**. It
> describes accurately what the software does. Before you take money from
> customers in a regulated market, have a lawyer read it once — particularly the
> liability and governing-law sections. Budget a few hundred dollars for an hour
> of review; it is the cheapest insurance on this list.

---

### 1.5 Register your WhatsApp Cloud API phone number — free, 20 minutes

**Why it matters.** Outbound WhatsApp messages currently fail with Meta error
**133010 — "number not registered"**. You can *receive* messages but not
*reply*, which makes the product useless on your most important channel. The
number must be explicitly registered with the Cloud API, which is a separate
step from adding it.

1. Go to <https://developers.facebook.com/apps> and open your app.
2. Left sidebar → **WhatsApp → API Setup**.
3. Under **From**, find your phone number. If it shows a warning or "Not
   registered", continue.
4. Left sidebar → **WhatsApp → Configuration** (some accounts show this under
   **API Setup → Manage phone numbers**).
5. Find the number and click **Register** / **Verify**. Meta asks for a
   **two-step verification PIN** — choose a 6-digit PIN and **write it down
   somewhere permanent**. You need it again if you ever move the number, and it
   cannot be recovered easily.
6. Complete the SMS or voice verification if prompted.
7. Confirm the number's status reads **Connected**.

**Verify it worked:** in your dashboard, open a WhatsApp conversation and send a
reply to a real phone. It must arrive. If you still get 133010, the registration
did not complete — repeat step 5 and check that the PIN was accepted.

Also worth knowing: outside a 24-hour window after a customer's last message,
WhatsApp only allows **approved template messages**. Replying to a fresh
customer message always works; chasing a two-day-old conversation does not.

---

### 1.6 Test a Neon backup restore — free, 20 minutes

**Why it matters.** Neon keeps history automatically, but **an untested backup
is not a backup**. The one time you need it you will be panicking, and that is
the worst moment to learn the procedure. Do it once now, calmly, and write down
what actually worked.

1. Open <https://console.neon.tech> and select your project.
2. Click **Branches** in the sidebar. You have a primary branch (probably
   `main`).
3. Click **Create branch**.
4. Name it `restore-test`.
5. For **Include data up to**, choose **a specific date and time** and pick
   roughly one hour ago.
6. Click **Create branch**. It takes a few seconds — Neon branches are
   copy-on-write, so this costs almost nothing and does not touch your live
   data.
7. Open the new branch, click **Connect**, and copy its connection string.
8. Verify the data is really there. From your dev machine:

```bash
psql "PASTE_THE_RESTORE_TEST_CONNECTION_STRING" -c "select count(*) from companies; select count(*) from messages; select max(\"createdAt\") from messages;"
```

The counts should be non-zero and the newest message timestamp should be around
an hour old. **That is the proof.**

9. Delete the `restore-test` branch when you are satisfied, so it does not count
   against your storage.

**Write down, in this file or next to it, the date you did this and anything
that differed from the steps above.** If a real restore is ever needed, the
procedure is the same except you point the app's `DATABASE_URL` at the restored
branch (or use Neon's **Reset from branch** to roll the primary back).

Also check now: Neon **Settings → History retention**. The free tier keeps
around 24 hours. If you want a longer window you need a paid plan — decide that
consciously rather than discovering the limit during an incident.

---

### 1.7 Confirm billing stays off — 1 minute

Customers pay you offline (bank transfer or cash) for now, so the subscription
module is switched off. `BILLING_ENABLED` is `false` in `render.yaml`, which
means no plan limits are enforced, no trial subscriptions are created, the
billing API answers `410 Gone`, and the dashboard hides the Billing page.

**Verify:** sign in as an owner and confirm there is **no Billing entry** in the
sidebar.

**When you are ready to sell monthly/yearly plans**, flip exactly one variable:

```
BILLING_ENABLED=true
```

Nothing else. The plan catalog seeds itself on the next startup, limits begin
being enforced, and the Billing page reappears. (Payment collection through
Stripe is a separate later step — with billing on and no Stripe key set, plan
changes apply immediately with no checkout, which is what you want while you are
still invoicing by hand.)

---

## Part 2 — can wait until you have customers

### 2.1 Meta OAuth one-click connect — 45 minutes

Without this, customers connect WhatsApp/Instagram/Messenger by pasting tokens
and IDs into a form. It works, but it is the ugliest part of onboarding and you
will be doing it for them over a call.

`docs/META-OAUTH.md` has the full flow, the exact permissions, and the
troubleshooting table. **Read that file** — it is not duplicated here. What you
need to end up with, set in Render:

| Variable | Where it comes from |
|---|---|
| `META_APP_ID` | Meta app dashboard → Settings → Basic → App ID |
| `META_APP_SECRET` | same page → App Secret → Show |
| `WHATSAPP_ES_CONFIG_ID` | WhatsApp → Embedded Signup → configuration id |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business → configuration id |
| `INSTAGRAM_APP_ID` | Instagram → API setup with Instagram login → Instagram App ID |
| `INSTAGRAM_APP_SECRET` | same page → Instagram App Secret |

The two `INSTAGRAM_*` values are **not** the same as the two `META_*` ones, even
though they live in the same Meta app. Instagram uses a different login model
(the only one that can receive DMs) with its own app identity, and its secret is
what signs Instagram webhooks. See *Instagram: which API* in
`docs/META-OAUTH.md`.

Three things that will bite you, all covered in `docs/META-OAUTH.md`:

- the **redirect URIs** must be added to the app's allowed lists **exactly**,
  with no trailing slash — one per flow:
  `https://ai-support-backend-hpub.onrender.com/api/v1/channels/oauth/meta/callback`
  and
  `https://ai-support-backend-hpub.onrender.com/api/v1/channels/oauth/instagram-login/callback`
- your Meta app must be in **Live** mode, not Development, before anyone outside
  your own account can use it — and Live mode requires the `/privacy` and
  `/terms` URLs from step 1.4 to be filled in.

### 2.2 Move file storage to a bucket (S3 / Cloudflare R2) — ~$0–5/month, 30 minutes

Images, voice notes and PDFs are stored **inside PostgreSQL** today. That works
and needs no action, but it bloats your database and your Neon storage bill as
customers upload more. There is a storage abstraction in place; when you want to
switch, provision a bucket and set the environment variables, then run the
migration script.

Cloudflare R2 is the cheaper choice (no egress fees, 10 GB free).

1. Cloudflare dashboard → **R2** → **Create bucket**. Name it e.g.
   `ai-support-media`.
2. **R2 → Manage R2 API Tokens → Create API token**. Permission: **Object Read
   & Write**, scoped to that bucket. Copy the **Access Key ID** and **Secret
   Access Key** — the secret is shown once.
3. Note your **endpoint**: `https://<account-id>.r2.cloudflarestorage.com`.
4. Bucket → **Settings → Public access**: either enable the r2.dev subdomain or
   attach a custom domain. Copy the resulting public base URL.
5. Set in Render: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, and `S3_REGION=auto`
   (R2 requires `auto`).
6. Copy the existing files across by running the migration script from your dev
   machine, with those same variables set:

```bash
npx tsx apps/backend/scripts/migrate-storage-to-s3.ts --dry-run
```

Read the dry-run output, then run it again without `--dry-run`. It is resumable:
if it is interrupted, run it again and it skips what it already copied.

**Verify:** open a product image and a customer's voice note in the dashboard.
If images render, the serving path is intact. (There is a specific header,
`Cross-Origin-Resource-Policy: cross-origin`, that makes embedded images work in
browsers; a mistake there breaks images in the browser only while `curl` still
looks fine, so check with your eyes, not a terminal.)

Two things worth knowing about the bucket:

- **Deleting a company also deletes its bucket objects.** You do not need a
  lifecycle rule for that. If the bucket refuses a delete, the account is still
  deleted and the stuck key is logged — search Render's logs for
  `company.delete.storageObjectFailed` if you ever want to clean one up by hand.
- Objects are laid out as `<kind>/<companyId>/<rowId>`, so you can always inspect
  or purge one tenant's files by prefix in the R2 console.

You do **not** need Redis. The background job queue runs on PostgreSQL by
design, because you are on a single instance — there is no extra service to
provision.

### 2.3 Add a real custom domain — ~$12/year, 30 minutes

`ai-support-backend-hpub.onrender.com` in a customer's browser looks like a
prototype. Render → Settings → **Custom Domains** walks you through it, then
update `CORS_ORIGINS`, `FRONTEND_APP_URL`, and the Meta redirect URI to match.

### 2.4 Deploy the frontend — free, 20 minutes

> **This is a prerequisite, not an optional extra.** It is filed in Part 2 only
> because it costs nothing. Nobody can sign up while the dashboard runs on your
> machine, and the Meta OAuth callback sends the browser to whatever
> `FRONTEND_APP_URL` says — which, unset, is `http://localhost:3000`. A customer
> completing a channel connect lands on a dead address.

`apps/frontend` is a normal Next.js app with **no workspace dependencies** and
`/widget/[publicId]` is server-rendered on demand, so it needs a Node runtime —
it is **not** a static export and cannot be dropped on shared hosting.

1. **DNS** — at whoever manages `thunder-haus.com`, add a CNAME:

   ```
   app  ->  cname.vercel-dns.com
   ```

   A subdomain of a domain you already own costs nothing and is available
   immediately; a product domain can replace it later by changing two variables.

2. **Vercel** — New Project → import the repo → set **Root Directory** to
   `apps/frontend`. Next.js is auto-detected. Add one environment variable:

   ```
   NEXT_PUBLIC_API_URL=https://ai-support-backend-hpub.onrender.com
   ```

   `NEXT_PUBLIC_*` is inlined at **build** time, not read at runtime — changing
   it later needs a redeploy, not a restart.

3. **Vercel → Settings → Domains** → add `app.thunder-haus.com`.

4. **Render (backend)** → Environment → set both, then restart:

   ```
   FRONTEND_APP_URL=https://app.thunder-haus.com
   CORS_ORIGINS=https://app.thunder-haus.com,http://localhost:3000
   ```

   They do different jobs and both are required: the first is where OAuth
   callbacks send the browser, the second is what lets the browser call the API
   at all. `CORS_ORIGINS` is comma-separated, so keeping `localhost:3000` in the
   list leaves local development working.

   No Meta change is needed — every OAuth redirect URI points at the *backend*,
   not the dashboard. Cookies already work cross-site (`COOKIE_SAME_SITE=none`,
   `COOKIE_SECURE=true` in `render.yaml`).

5. **Verify** — `https://app.thunder-haus.com` shows the login page, and:

   ```bash
   curl -s -o /dev/null -w "%{redirect_url}\n" "https://ai-support-backend-hpub.onrender.com/api/v1/channels/oauth/instagram-login/callback?code=x&state=y"
   ```

   must now redirect to `app.thunder-haus.com`, not `localhost:3000`. That one
   line proves step 4 landed.

### 2.5 Run the browser smoke tests before each release — free, 5 minutes

There is a Playwright suite that drives a real browser through login, creating a
product with an image, replying in the inbox, and a 375px mobile pass. It runs
against a **local** frontend and backend, never production. See
`apps/frontend/e2e/README.md` for the exact commands.

---

## Part 3 — day-of-launch smoke test (10 minutes)

Run this in order, on your phone if you can. Every step is something a customer
will do in their first ten minutes.

1. **Cold start.** After leaving the app idle 20 minutes, open
   `/health`. Answers in under a second. *(If not: step 1.1 did not apply.)*
2. **Register.** Create an account with a real email you can open. The
   verification code arrives. You get into the dashboard. *(If not: step 1.2.)*
3. **Forgot password.** Sign out → **Forgot password?** → the reset link
   arrives, works, and your old password no longer does.
4. **Legal pages.** `/privacy` and `/terms` show no yellow banner and no
   `[ FILL IN` text.
5. **Connect a channel.** Connect WhatsApp (or Telegram, which is fastest).
   Status shows **Connected**.
6. **Receive.** Message the connected number from your own phone. It appears in
   the Inbox within a few seconds.
7. **Reply as a human.** Send a reply from the dashboard. It arrives on your
   phone. *(If WhatsApp fails with 133010: step 1.5.)*
8. **AI reply.** Turn on Auto-reply in AI Settings, send another message, and
   confirm the assistant answers using your own business information.
9. **Upload a PDF.** Knowledge Base → upload a document. It shows
   **Processing**, then **Ready** within a few seconds. Ask the assistant
   something only that PDF answers.
10. **Product image.** Add a product with a photo. Open the image — it must
    render, not show a broken icon.
11. **Mobile.** On a phone, visit Overview, Inbox, Products and Profile. Nothing
    scrolls sideways.
12. **Billing hidden.** No Billing entry in the sidebar.
13. **Export.** Profile → **Download export**. A JSON file downloads and
    contains your company and messages.

If all thirteen pass, you can onboard a paying customer.

---

## Quick reference — every variable you must set by hand

| Variable | Part | Notes |
|---|---|---|
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | 1.2 | Without these, no email is ever sent |
| `SENTRY_DSN` | 1.3 | Optional but strongly recommended |
| `LEGAL_ENTITY_NAME` `LEGAL_ENTITY_ADDRESS` `LEGAL_CONTACT_EMAIL` `LEGAL_DATA_RETENTION` `LEGAL_JURISDICTION` | 1.4 | Blanks in the legal template |
| `BILLING_ENABLED` | 1.7 | The single switch that re-enables subscriptions |
| `META_APP_ID` `META_APP_SECRET` `WHATSAPP_ES_CONFIG_ID` `META_LOGIN_CONFIG_ID` | 2.1 | One-click channel connect; see `docs/META-OAUTH.md` |
| `S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_PUBLIC_BASE_URL` `S3_REGION` | 2.2 | Only when moving files out of PostgreSQL |

**Never commit any of these values to git.** They belong in Render's Environment
tab only. If you ever paste a secret somewhere it should not be — a chat, a
ticket, a screenshot — rotate it at the source rather than hoping.

## What is deliberately NOT here

- **Stripe / card payments.** You are invoicing offline. When that changes, turn
  billing on first (1.7), then add Stripe.
- **Redis.** Not needed. The job queue and the retry sweeper both run on
  PostgreSQL inside the single instance.
- **A second Render instance.** The background worker runs in the API process.
  If you ever scale to two instances, the queue's row locking already handles
  it, but revisit the retry sweeper before you do.
