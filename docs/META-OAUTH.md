# Meta OAuth / Embedded Signup — one-click channel connect

Customers can connect **WhatsApp**, **Facebook Messenger**, and **Instagram**
in a few clicks ("Connect with Meta") instead of copying IDs and tokens. The
manual credential forms remain available as an advanced fallback, and are the
only path while OAuth is unconfigured. Telegram is unaffected — it already
uses its official BotFather flow.

The feature is **entirely optional**: without `META_APP_ID` / `META_APP_SECRET`
the OAuth endpoints report `configured: false`, the dashboard hides the
one-click button, and everything else keeps working.

## How the flow works

1. Dashboard calls `POST /api/v1/channels/oauth/meta/start` with
   `{ provider: "facebook" | "instagram" | "whatsapp" }` (OWNER/ADMIN).
2. The backend returns a `https://www.facebook.com/{version}/dialog/oauth` URL
   containing `client_id`, `config_id`, `response_type=code`, the callback
   `redirect_uri`, and a **signed state** (HMAC-SHA256 with `JWT_ACCESS_SECRET`
   over `{ companyId, userId, provider, nonce, iat }`, 10-minute TTL — no
   server-side session).
3. The user authorizes in Meta's dialog and lands on the **public** callback
   `GET /api/v1/channels/oauth/meta/callback?code=…&state=…`. The state is
   verified (signature + expiry), then:
   - **facebook / instagram**: the code is exchanged for a user token and
     `GET /me/accounts?fields=id,name,access_token,instagram_business_account`
     lists **every** granted Page. Instagram keeps only Pages that have a linked
     `instagram_business_account` (a Page without one cannot be connected, so it
     is never offered).
   - **whatsapp**: the code is exchanged for a business token; **all** WABA ids
     are unioned from the `GET /debug_token` granular scopes, and every WABA's
     numbers are read from `GET /{waba_id}/phone_numbers`.

   Then, in both cases:
   - **exactly one** connectable asset -> it is connected immediately (the
     common case stays one click)
   - **more than one** -> nothing is connected. See *Asset selection* below.
4. Credentials are encrypted (AES-256-GCM) exactly like the manual flow, a
   health check runs, and the app is subscribed to webhooks
   (`POST /{page_id}/subscribed_apps` with `subscribed_fields=messages`, or
   `POST /{waba_id}/subscribed_apps`). Subscription failure is **non-fatal**
   (logged; webhooks can be wired manually).
5. The browser is 302-redirected to
   `${FRONTEND_APP_URL}/dashboard/channels?connected=<provider>` on success or
   `?connect_error=<safe_code>` on failure (codes only — never tokens or raw
   error messages).

There is also `POST /api/v1/channels/oauth/meta/whatsapp/complete`
(authenticated, OWNER/ADMIN) accepting `{ code, phoneNumberId?, wabaId? }` for
the JS-SDK Embedded Signup **popup** variant, where the frontend receives those
values via `postMessage`.

### Asset selection

An authorization often grants more than one connectable asset — an agency with
ten client Pages, a business with two WABAs, a WABA with several numbers.
Connecting whichever one Graph returned first is a guess, and a wrong guess
wires a live customer channel to the wrong brand; it may go unnoticed until a
customer's message lands in the wrong inbox.

So when 2+ assets are eligible the flow **connects nothing** and instead:

1. Stores the discovered assets in `meta_oauth_selections`, **encrypted**
   (AES-256-GCM, the same service as channel credentials) because the payload
   carries Page/business access tokens. TTL 15 minutes, single-use.
2. Redirects to
   `${FRONTEND_APP_URL}/dashboard/channels/select?selection=<id>&provider=<p>`.
3. The picker reads `GET /api/v1/channels/oauth/meta/selection/:selectionId`
   (authenticated, OWNER/ADMIN). The response carries **ids and display names
   only** — no access token ever reaches the browser.
4. The operator's choice is sent to
   `POST /api/v1/channels/oauth/meta/selection/:selectionId/connect` with
   `{ pageId }` or `{ wabaId, phoneNumberId }`. Only that asset is connected.

A WABA with three numbers is **three** choices, not one: picking the wrong
number is as wrong as picking the wrong business.

The `whatsapp/complete` popup variant behaves the same way — it answers `201`
with `{ account }` when the grant was unambiguous, or `200` with
`{ requiresSelection: true, selection }` when the operator must choose.

#### Security properties

Two independent checks stand between a request and a live channel:

- **Tenant scoping.** A selection is loaded with `companyId` in the WHERE
  clause, so another company holding the id cannot read or consume it. Every
  unusable case — unknown id, another tenant's id, already consumed, expired —
  answers the same `404`, so the endpoint cannot be used to probe which
  selection ids exist.
- **Membership.** The chosen ids must appear in **that selection's** stored
  assets. A caller cannot name an arbitrary Page or WABA and have the backend
  connect it with a token it holds. For WhatsApp the number must belong to the
  **chosen** WABA, so a valid-looking pair cannot be assembled from two
  different businesses.

A rejected choice (`400 ASSET_NOT_IN_GRANT`) does **not** burn the selection —
a typo must not force the operator through the whole Meta authorization again.
A successful connect does, so a selection can never be replayed.

> **Behaviour change.** `whatsapp/complete` previously trusted any
> `wabaId` / `phoneNumberId` the caller sent and connected it using our business
> token. Those ids are now verified against the grant first.

## Environment variables (backend)

| Variable | Required | Description |
| --- | --- | --- |
| `META_APP_ID` | to enable OAuth | Your Meta app id. |
| `META_APP_SECRET` | to enable OAuth | Your Meta app secret. Also stored (encrypted) per connected account for webhook signature validation. |
| `META_GRAPH_API_VERSION` | no (default `v21.0`) | Graph API version used for the dialog + API calls. |
| `WHATSAPP_ES_CONFIG_ID` | for WhatsApp | Embedded Signup configuration id. |
| `META_LOGIN_CONFIG_ID` | for Messenger + Instagram | Facebook Login for Business configuration id. |
| `FRONTEND_APP_URL` | no (default `http://localhost:3000`) | Dashboard origin the callback redirects back to. |

Set them in `apps/backend/.env` locally (see `.env.example`) and in the Render
dashboard for production (see `.env.render.example`).

## Meta app dashboard — operator checklist

All of this happens at <https://developers.facebook.com> on **your** app (the
platform app; customers never create apps).

1. **App type**: Business. Add the products **Facebook Login for Business**,
   **Messenger**, **Instagram**, and **WhatsApp**.
2. **Valid OAuth Redirect URI** (Facebook Login for Business → Settings):

   ```
   https://<your-backend-host>/api/v1/channels/oauth/meta/callback
   ```

   Use the exact public backend origin (the app trusts the proxy, so this is
   `https://…` on Render). Localhost testing requires an HTTPS tunnel
   (e.g. ngrok) because Meta only redirects to HTTPS.
3. **Facebook Login for Business configuration** (`META_LOGIN_CONFIG_ID`):
   create a configuration with these permissions and copy its id:
   - `pages_show_list`, `pages_messaging`, `pages_manage_metadata`,
     `pages_read_engagement`
   - `instagram_basic`, `instagram_manage_messages` (for Instagram)
   - `business_management`
4. **WhatsApp Embedded Signup configuration** (`WHATSAPP_ES_CONFIG_ID`):
   under WhatsApp → Embedded Signup, create a configuration and copy its id.
   Its permissions must include `whatsapp_business_management` and
   `whatsapp_business_messaging`.
5. **Webhooks**: use the SHARED endpoints (see below). Set the callback URL and
   the verify token ONCE per object type and never touch them again — they do
   not contain a channel account id, so they serve every customer. Subscribe to
   the `messages` field for the Page, Instagram, and WhatsApp Business Account
   objects. The OAuth flow calls `subscribed_apps` per connected asset
   automatically; the app-level callback URL + verify token are what tell Meta
   where to deliver.
6. **App Review / Live mode**: to connect assets owned by arbitrary customers,
   the app must be in **Live** mode with Advanced Access approved for the
   permissions above. In Development mode only assets owned by app
   roles/testers connect.

## Webhooks: one URL for every customer

A Meta app has exactly **one** callback URL per object type, shared by every
business that connects through it. The per-account URL
(`/api/v1/webhooks/<provider>/<channelAccountId>`) therefore cannot be used
with one-click connect: it is pinned to a single tenant, so the second customer
to connect would have their messages delivered to the first customer's account —
or dropped.

So Meta-owned providers also expose an **account-less** endpoint:

```
https://<your-backend-host>/api/v1/webhooks/facebook
https://<your-backend-host>/api/v1/webhooks/instagram
https://<your-backend-host>/api/v1/webhooks/whatsapp
```

with a single platform verify token, `META_WEBHOOK_VERIFY_TOKEN`.

The account is resolved from the payload rather than the URL:

| Provider | Matched against the stored account |
| --- | --- |
| Messenger | `entry[].id` (Page id) |
| Instagram | `entry[].id` (Instagram account id) |
| WhatsApp | `entry[].changes[].value.metadata.phone_number_id`, then `entry[].id` (WABA) |

Because one POST may legitimately batch entries for several tenants, the body is
**split per entry** and each slice is resolved and parsed on its own — one
tenant's events can never be parsed under another's account. Entries for a
target nobody has connected are logged (`webhook.shared.unresolved`) and
acknowledged: returning an error would make Meta retry forever and eventually
disable the subscription for **every** tenant.

Signature verification uses `META_APP_SECRET` — the platform app signed the
request, and there is no tenant to check against until the payload has been
routed. With either `META_APP_SECRET` or `META_WEBHOOK_VERIFY_TOKEN` unset the
shared endpoints answer 404 rather than accepting unsigned traffic on a URL that
fans out to every customer.

**The per-account endpoint is unchanged.** A customer connecting manually with
their own Meta app keeps their own URL, their own verify token and their own app
secret. Only Meta providers implement shared routing; Telegram and Web Chat stay
per-account.

## Safe error codes

The callback redirects with `?connect_error=<code>` where code is one of
`ACCESS_DENIED`, `INVALID_STATE`, `OAUTH_NOT_CONFIGURED`,
`TOKEN_EXCHANGE_FAILED`, `NO_PAGES`, `NO_INSTAGRAM_ACCOUNT`, `NO_WABA`,
`NO_PHONE_NUMBER`, `ALREADY_CONNECTED`, `CONNECT_FAILED`. The channels page
maps these to friendly messages.

## Testing

`apps/backend/tests/meta-oauth.test.ts` covers the status/start gating, state
signing (round-trip, expiry, tamper rejection), the Facebook/Instagram
callback paths, the WhatsApp complete + callback paths, and error mapping.

`apps/backend/tests/meta-oauth-selection.test.ts` covers asset selection: the
multi-Page / multi-Instagram / multi-WABA pickers, the one-asset fast paths,
single-use and expiry, cross-tenant isolation (including two tenants holding a
pending selection at once), rejection of ids outside the grant, and that no
access token appears in any response or in the stored row.

Both run against an injected fake Graph transport
(`setMetaOauthTransportForTesting`), so no real Meta calls are ever made.
`npm test -w apps/backend -- meta-oauth` runs them together.

### Trying the picker without a Meta app

The picker only needs a row in `meta_oauth_selections`, so it can be exercised
before `META_APP_ID` exists: insert one (encrypted with
`channelSecurityService.encrypt`) for your company and open
`/dashboard/channels/select?selection=<id>&provider=<p>`. Reading the selection
and every access check work; **pressing Connect will not**, because storing the
channel credentials needs `META_APP_SECRET` — it fails fast with
`OAUTH_NOT_CONFIGURED` rather than half-connecting.
