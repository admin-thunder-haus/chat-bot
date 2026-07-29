# End-to-end smoke suite (Playwright)

Four headless Chromium specs that drive the real dashboard against a **local**
backend on a **local, seeded** database.

| Spec | What it proves |
|---|---|
| `login.spec.ts` | The seeded demo account signs in and lands on the dashboard overview. |
| `products.spec.ts` | A product can be created with an uploaded image, and the image appears in the product list. |
| `inbox.spec.ts` | A seeded conversation opens, a reply sends, and it shows in the thread (and survives a reload). |
| `mobile.spec.ts` | No horizontal **page** scroll at 375px on the main dashboard pages (docs/DESIGN-SYSTEM.md §5). |

These are **not** part of `npm test`. Vitest only collects
`src/**/*.test.{ts,tsx}`; Playwright only collects `e2e/**/*.spec.ts`. Neither
runner can see the other's files.

## It never runs against production

The suite writes real data (products, uploaded images, sent messages), so it is
locked to localhost by two independent guards:

1. **Config guard** (`e2e/env.ts`) — `E2E_BASE_URL` and `E2E_API_URL` must both be
   loopback URLs. Anything else aborts the run before a browser starts.
2. **Runtime guard** (`e2e/fixtures.ts`) — any http(s) request the page makes to a
   non-loopback origin is **blocked** and fails the test. This exists because
   `apps/frontend/.env.local` may point `NEXT_PUBLIC_API_URL` at the deployed
   Render backend: a dev server started without an explicit override would serve
   a bundle talking to production while every configured URL still looked local.

Never point `DATABASE_URL` at Neon when preparing this suite, and never run a
migration against `apps/backend/.env` — that file is production.

## Running it

Five steps. Run each from the **repo root** unless stated otherwise.

### 1. Start the test database

```powershell
docker start ai_support_postgres
```

Postgres is exposed on `localhost:5435`. Create the e2e database once:

```powershell
docker exec ai_support_postgres psql -U postgres -c "CREATE DATABASE ai_support_e2e"
```

### 2. Migrate + seed that database

Both commands override the connection strings **in the shell** so nothing can
fall back to `apps/backend/.env`:

```powershell
cd apps\backend
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5435/ai_support_e2e?schema=public"
$env:DIRECT_URL   = $env:DATABASE_URL
npx prisma migrate deploy
npm run prisma:seed
cd ..\..
```

### 3. Start the backend against it

Same shell, same overrides, plus the variables `src/config/env.ts` requires at
startup:

```powershell
cd apps\backend
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5435/ai_support_e2e?schema=public"
$env:DIRECT_URL   = $env:DATABASE_URL
$env:NODE_ENV     = "development"
$env:BACKEND_PORT = "4000"
$env:CORS_ORIGINS = "http://localhost:3000"
$env:COOKIE_SECURE = "false"
$env:COOKIE_SAME_SITE = "lax"
$env:AI_FEATURE_ENABLED = "false"
$env:JWT_ACCESS_SECRET  = "e2e-access-secret-at-least-32-characters-long"
$env:JWT_REFRESH_SECRET = "e2e-refresh-secret-at-least-32-characters-long-diff"
# Each spec signs in for real. The default limiter (20 per 15 minutes) allows
# only a handful of runs before it starts answering 429 and every spec fails at
# the login step; raise it for the e2e backend.
$env:AUTH_RATE_LIMIT_MAX = "500"
npm run dev
```

Leave it running. `curl http://localhost:4000/api/v1/health` should report
`database: up`.

### 4. Run the suite

```powershell
npm run e2e -w apps/frontend
```

**The frontend starts itself.** Playwright's `webServer` runs
`npx next dev -p <port from E2E_BASE_URL>` with `NEXT_PUBLIC_API_URL` set to
`E2E_API_URL`, waits for it, and shuts it down afterwards. An already-running dev
server on that port is reused instead (outside CI) — but only start one yourself
if you pass the API URL explicitly:

```powershell
cd apps\frontend
$env:NEXT_PUBLIC_API_URL = "http://localhost:4000"
npm run dev
```

Starting it *without* that variable makes it read `.env.local` and talk to the
deployed backend; the runtime guard then fails every test with an explanation
rather than letting the run touch production.

Only the frontend is managed by Playwright. The backend is not, deliberately: it
needs a running Postgres and a seeded schema, and `webServer` cannot express that
ordering — a half-seeded database would surface as mystery assertion failures
instead of a clear setup error.

### 5. Useful variations

```powershell
npm run e2e -w apps/frontend -- e2e/login.spec.ts     # one spec
npm run e2e -w apps/frontend -- --headed              # watch it
npm run e2e -w apps/frontend -- --debug               # step through
npm run e2e:ui -w apps/frontend                       # Playwright UI mode
npx playwright show-report                            # last HTML report (CI reporter)
```

## Environment variables

All optional — the defaults are the standard local setup.

| Variable | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | Frontend origin under test; also the port the managed dev server binds. Must be loopback. |
| `E2E_API_URL` | `http://localhost:4000` | Backend origin; passed to the dev server as `NEXT_PUBLIC_API_URL`. Must be loopback. |
| `E2E_EMAIL` | `owner@demo.com` | Seeded demo login (`admin@demo.com` / `agent@demo.com` also exist). |
| `E2E_PASSWORD` | `Demo12345` | Seeded demo password. |
| `CI` | unset | When set: 2 retries, `forbidOnly`, no dev-server reuse, HTML report. |

Credentials come from `apps/backend/prisma/seed.ts`; nothing is hardcoded in a
spec. Two agents sharing one machine can run in parallel by giving each its own
ports, e.g. `E2E_BASE_URL=http://localhost:3100 E2E_API_URL=http://localhost:4010`
(add that frontend origin to the backend's `CORS_ORIGINS`).

## The bug this suite already caught (fixed)

All four specs pass. On its first run `mobile.spec.ts` failed on Products and
Services with `scrollWidth` 390 vs `clientWidth` 375 — a genuine violation of
§5, not a flaky assertion.

Cause: `Toolbar`'s `filters` wrapper in `apps/frontend/src/components/ui.tsx` used
`[&>*]:w-full`, forcing `width: 100%` on every direct child. Several pages pass a
visually hidden `<label className="sr-only">` as one of those children
(`products/page.tsx`, `services/page.tsx`, `faqs/page.tsx`,
`knowledge-base/page.tsx`). The child-combinator selector outranks Tailwind's
`.sr-only { width: 1px }`, so the hidden label became a 375px-wide absolutely
positioned box starting 15px in from the left — 15px past the viewport — and the
whole document scrolled.

Fixed in `ui.tsx` by narrowing the selector to `[&>*:not(.sr-only)]:w-full` (and
the `sm:` counterpart), which leaves `.sr-only` at `width: 1px`. All four affected
pages now measure 375/375 at 375px.

Keep this spec asserting on `document.documentElement` and never on inner
containers: wide content is *allowed* to scroll inside its own `overflow-x-auto`
box, and it was the document-level measurement that made this bug visible at all.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `REFUSING TO RUN — E2E_API_URL is not a local address` | A non-loopback URL was configured. Working as intended. |
| `The app tried to reach a NON-LOCAL origin` | The dev server was built without `NEXT_PUBLIC_API_URL` and inlined `.env.local`'s production URL. Stop it, `rm -rf apps/frontend/.next` (the value is baked into the client bundle), and let Playwright start it. |
| Every spec fails at the login step | The backend's auth limiter is answering 429. Restart it with `AUTH_RATE_LIMIT_MAX=500`, or wait out the 15-minute window. |
| `Process from config.webServer exited early` / `EADDRINUSE` | Something already holds the port but is not answering. Kill it, or pick another port with `E2E_BASE_URL`. |
| Login succeeds but pages show errors | The database is migrated but not seeded — re-run step 2. |
