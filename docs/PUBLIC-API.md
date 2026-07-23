# Public API & Outbound Webhooks

The platform exposes a read-only public API for third-party integrations plus
signed outbound webhooks for real-time event delivery. Both are managed from
the dashboard (**Integrations** page) or via the `/api/v1/integrations`
management endpoints (OWNER / ADMIN).

- Public API base URL: `https://<your-backend>/api/public/v1`
- All responses use the standard envelope: `{ "success": true, "message": "…", "data": { … } }`

---

## Authentication

Create an API key on the Integrations page (or `POST /api/v1/integrations/api-keys`).
The full key (`ak_live_` + 32 hex characters) is returned **exactly once** —
only a SHA-256 hash is stored, so it can never be shown again. Send it as a
Bearer token:

```
GET /api/public/v1/me
Authorization: Bearer ak_live_0123456789abcdef0123456789abcdef
```

- Revoked keys are rejected with `401` immediately.
- Keys carry scopes; every current endpoint requires the `read` scope
  (the default).
- The tenant is derived from the key — data from other companies is never
  visible, regardless of the ids you request.

### Key management (dashboard JWT, OWNER/ADMIN)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/integrations/api-keys` | Create. Body: `{ "name": "CI key", "scopes": ["read"] }`. Returns `{ apiKey, key }` — `key` is shown once. |
| `GET` | `/api/v1/integrations/api-keys` | List (prefix only, never the key). |
| `DELETE` | `/api/v1/integrations/api-keys/:id` | Revoke. |

---

## Public endpoints (scope: `read`)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/public/v1/me` | Company name + key info (introspection). |
| `GET` | `/api/public/v1/conversations?page=1&limit=20` | Paginated conversations, newest activity first. |
| `GET` | `/api/public/v1/conversations/:id` | One conversation + its 20 most recent messages. |
| `GET` | `/api/public/v1/customers?page=1&limit=20` | Paginated customers, newest first. |

Example — `GET /api/public/v1/conversations`:

```json
{
  "success": true,
  "message": "Conversations retrieved successfully",
  "data": {
    "items": [
      {
        "id": "1e6c…",
        "channelType": "WHATSAPP",
        "status": "OPEN",
        "priority": "NORMAL",
        "subject": null,
        "customer": { "id": "9af2…", "fullName": "Jane Doe" },
        "createdAt": "2026-07-23T10:15:00.000Z",
        "lastMessageAt": "2026-07-23T10:20:00.000Z",
        "resolvedAt": null
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

`GET /api/public/v1/conversations/:id` additionally returns
`data.messages`: `[{ id, direction, senderType, contentType, content, mediaUrl, status, createdAt }]`.

---

## Outbound webhooks

Configure an HTTPS endpoint and the events you care about; the platform POSTs
a signed JSON payload on every occurrence.

### Management (dashboard JWT, OWNER/ADMIN)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/integrations/webhooks` | Create. Body: `{ "url": "https://…", "events": ["conversation.created"] }`. Returns `{ webhook, secret }` — the signing `secret` (`whsec_…`) is shown **once** and stored encrypted (AES-256-GCM). |
| `GET` | `/api/v1/integrations/webhooks` | List (includes `deliveryCount`). |
| `PATCH` | `/api/v1/integrations/webhooks/:id` | Update `{ url?, events?, isActive? }`. Re-enabling resets the failure streak. |
| `DELETE` | `/api/v1/integrations/webhooks/:id` | Delete. |
| `GET` | `/api/v1/integrations/webhooks/:id/deliveries` | Last 20 delivery-log rows. |

### Delivery contract

Each event is delivered as:

```
POST <your url>
Content-Type: application/json
X-Webhook-Event: conversation.created
X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>
```

```json
{
  "id": "5f0e2b8c-…",
  "type": "conversation.created",
  "createdAt": "2026-07-23T10:15:00.000Z",
  "data": {
    "title": "New WHATSAPP conversation",
    "body": "Jane Doe started a new conversation on WHATSAPP",
    "conversationId": "1e6c…",
    "customerId": "9af2…",
    "channelType": "WHATSAPP"
  }
}
```

- **Timeout:** 10 seconds per attempt. Any 2xx response counts as delivered.
- **Retries:** up to 3 attempts per event with a short backoff.
- **Auto-disable:** after 20 consecutive failed deliveries the endpoint is
  deactivated (`isActive: false`); any successful delivery resets the streak,
  and re-enabling from the dashboard clears it too.

### Verifying the signature (Node.js)

Always verify `X-Webhook-Signature` against the **raw** request body using the
secret returned at creation:

```js
const crypto = require('node:crypto');
const express = require('express');

const app = express();

app.post(
  '/hooks',
  express.raw({ type: 'application/json' }), // keep the raw bytes!
  (req, res) => {
    const secret = process.env.WEBHOOK_SECRET; // whsec_…
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const received = req.get('X-Webhook-Signature') ?? '';

    const valid =
      received.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    if (!valid) return res.status(401).send('invalid signature');

    const event = JSON.parse(req.body.toString('utf8'));
    console.log(event.type, event.data);
    res.sendStatus(200);
  },
);
```

---

## Event catalog

| Event | Fired when | `data` payload (plus `title`/`body`) |
| --- | --- | --- |
| `conversation.created` | A customer message opens a new conversation on any channel | `{ conversationId, customerId, channelType }` |
| `conversation.resolved` | A conversation is marked RESOLVED | `{ conversationId, previousStatus }` |
| `customer.created` | A never-seen-before customer contacts you | `{ customerId, channelType }` |
| `handoff.requested` | The AI hands a conversation to your team (customer request or low confidence) | `{ conversationId, reason }` |
| `ai.reply_failed` | The AI could not generate an auto-reply | `{ conversationId, reason }` |
| `subscription.updated` | Plan change, cancellation, resume, or a payment-provider status change | `{ planCode?, billingCycle?, status?, … }` |
| `action.executed` | The AI executes a business action (appointments, orders, …) | Action-specific ids |

Sample `handoff.requested` payload:

```json
{
  "id": "d1c1…",
  "type": "handoff.requested",
  "createdAt": "2026-07-23T11:02:44.000Z",
  "data": {
    "title": "Human handoff requested",
    "body": "A conversation was handed off to your team (reason: customer_request)",
    "conversationId": "1e6c…",
    "reason": "customer_request"
  }
}
```
