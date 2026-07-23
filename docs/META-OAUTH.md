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
   - **facebook / instagram**: the code is exchanged for a user token, the
     first granted Page is read from `GET /me/accounts?fields=id,name,access_token,instagram_business_account`,
     and the existing connect service is called with the Page token, the
     platform `META_APP_SECRET`, and a server-generated verify token. Instagram
     additionally requires the Page to have a linked
     `instagram_business_account`.
   - **whatsapp**: the code is exchanged for a business token; the WABA id is
     read from `GET /debug_token` granular scopes; the first phone number from
     `GET /{waba_id}/phone_numbers` is connected via the existing WhatsApp
     connect service.
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

### Known v1 limitation

If the user grants access to **multiple** Facebook Pages, the **first** page
returned by `/me/accounts` is connected. Ask customers to select a single Page
in the Meta dialog, or reconnect after adjusting the granted assets.

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
5. **Webhooks**: configure the Webhooks product with the callback URLs this
   platform already exposes per channel account
   (`/api/v1/webhooks/<provider>/<channelAccountId>` — shown in the dashboard
   after connecting) and subscribe to the `messages` fields for Page,
   Instagram, and WhatsApp Business Account objects. The OAuth flow calls
   `subscribed_apps` automatically, but the app-level webhook endpoint +
   verify token must exist once in the Meta dashboard.
6. **App Review / Live mode**: to connect assets owned by arbitrary customers,
   the app must be in **Live** mode with Advanced Access approved for the
   permissions above. In Development mode only assets owned by app
   roles/testers connect.

## Safe error codes

The callback redirects with `?connect_error=<code>` where code is one of
`ACCESS_DENIED`, `INVALID_STATE`, `OAUTH_NOT_CONFIGURED`,
`TOKEN_EXCHANGE_FAILED`, `NO_PAGES`, `NO_INSTAGRAM_ACCOUNT`, `NO_WABA`,
`NO_PHONE_NUMBER`, `ALREADY_CONNECTED`, `CONNECT_FAILED`. The channels page
maps these to friendly messages.

## Testing

`apps/backend/tests/meta-oauth.test.ts` covers the status/start gating, state
signing (round-trip, expiry, tamper rejection), the Facebook/Instagram
callback paths, the WhatsApp complete + callback paths, and error mapping —
all against an injected fake Graph transport
(`setMetaOauthTransportForTesting`), so no real Meta calls are ever made.
