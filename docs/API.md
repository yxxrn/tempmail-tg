# HTTP API — tempmail-tg

Base URL: `https://tempmail-tg.<subdomain>.workers.dev`

## Auth

| Endpoint | Header |
|---|---|
| `/api/new` | `X-API-Key: <API_KEY>` (Worker secret) |
| `/api/inbox`, `/api/mail/:id` | `Authorization: Bearer <address.token>` |
| `/api/telegram` | `X-Telegram-Bot-Api-Secret-Token: <WEBHOOK_SECRET>` |

## `GET /health`

```
ok
```

## `POST /api/new`

Create address.

Headers:

```
X-API-Key: <API_KEY>
Content-Type: application/json
```

Body (semua field opsional):

```json
{
  "domain": "example.com",
  "owner_chat_id": "123456789"
}
```

- `domain` harus aktif di table `domains`
- `owner_chat_id` default: first id di `ALLOWED_CHAT_IDS`

Response `200`:

```json
{
  "id": "hex32",
  "address": "local@example.com",
  "token": "hex64"
}
```

Errors: `401`, `400` (no domain / inactive), `429` (limits).

## `GET /api/inbox?address=`

List mail previews (max 20).

```
Authorization: Bearer <token>
```

Response:

```json
[
  {
    "id": "...",
    "from": "...",
    "subject": "...",
    "received_at": "ISO-8601",
    "preview": "first 200 chars"
  }
]
```

## `GET /api/mail/:id`

Full mail row. Same Bearer token as address owner.

## `POST /api/telegram`

Telegram webhook. Jangan dipanggil manual kecuali testing dengan secret yang benar.

## Contoh curl

```bash
# new
curl -sS -X POST "$BASE/api/new" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","owner_chat_id":"123"}'

# inbox
curl -sS "$BASE/api/inbox?address=local@example.com" \
  -H "Authorization: Bearer $TOKEN"

# mail
curl -sS "$BASE/api/mail/$MAIL_ID" \
  -H "Authorization: Bearer $TOKEN"
```
