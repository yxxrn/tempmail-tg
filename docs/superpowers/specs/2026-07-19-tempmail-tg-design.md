# tempmail-tg — Design Spec

**Date:** 2026-07-19  
**Status:** Approved (design sections §1–§5)  
**Owner:** Ruije (private → multi-user later)

## 1. Goal

Self-owned temporary email for personal signup/OTP verification, operated via Telegram bot. Multi-domain (domains can be swapped without bot rewrite). Fully on Cloudflare (no VPS).

**Success criteria**
- User can `/new` and receive a usable `@domain` address in Telegram
- Inbound mail arrives in D1 and is pushed to the owner chat with OTP/link heuristics
- Adding/disabling a domain is data + DNS only (no code change)
- Private whitelist only in v1; multi-user can be enabled later via flag + `/adduser`

## 2. Non-goals (v1)

- Outbound SMTP / reply-to email
- Web UI
- Multi-tenant billing / public open signup
- AutoCf `mail-adapter` wire-compatible paths (deferred to v1.1)
- Perfect OTP extraction (best-effort regex only)
- Guaranteed CF email retry on D1 failure

## 3. Architecture

```
Situs/OTP ──MX──► Cloudflare Email Routing (catch-all)
                        │
                        ▼ Email Worker event
              ┌─────────────────────────┐
              │ Worker: tempmail-tg     │
              │  - email handler → D1   │
              │  - Telegram webhook     │
              │  - HTTP API             │
              └───────────┬─────────────┘
                          │
                          ▼
                     D1 (SQLite)
                          ▲
User ──Telegram Bot API───┘
```

| Component | Role |
|---|---|
| Domain(s) | MX → Cloudflare; multi-domain, on/off via `domains.active` |
| CF Email Routing | Catch-all `*@domain` → Worker email binding |
| Worker (TS) | Single codebase: email ingest + bot + API |
| D1 | `domains`, `addresses`, `mails`, `users` |
| Telegram Bot | Private UX; webhook to Worker |

**Stack:** Cloudflare Workers (TypeScript), D1, Wrangler, Telegram Bot API (HTTP webhook only).

## 4. Data model (D1)

```sql
domains (
  name TEXT PRIMARY KEY,
  active INTEGER DEFAULT 1,
  created_at TEXT
)

addresses (
  id TEXT PRIMARY KEY,
  address TEXT UNIQUE,
  local_part TEXT,
  domain TEXT,
  owner_chat_id TEXT,
  token TEXT UNIQUE,
  created_at TEXT,
  expires_at TEXT,          -- null in v1 (no auto-expire)
  active INTEGER DEFAULT 1
)

mails (
  id TEXT PRIMARY KEY,
  address_id TEXT,
  from_addr TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TEXT,
  read INTEGER DEFAULT 0
)

users (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  role TEXT DEFAULT 'user', -- user | admin
  active INTEGER DEFAULT 1,
  created_at TEXT
)
```

**Rules**
- `/new` picks random row from `domains WHERE active=1` (or explicit domain if provided and active)
- Soft-delete address: `addresses.active=0`
- Inbound: match `To` → active `addresses.address`; else drop + log
- Bootstrap: seed admin `chat_id` + at least one domain at deploy

## 5. Telegram bot UX

**Mode v1:** private whitelist (`users.active=1` and/or env `ALLOWED_CHAT_IDS`).  
**Flag:** `MULTI_USER=false` (env). When true, `/adduser` enables additional chats; public open registration remains out of scope.

### Commands (all users)

| Command | Action |
|---|---|
| `/start` | Auth check; greeting + command list |
| `/new [domain]` | Create random local-part on active domain |
| `/list` | Active addresses owned by chat |
| `/inbox [address\|id]` | Last 10 mails; default newest address |
| `/read <mail_id>` | Full body_text; extract OTP/links |
| `/del <address\|id>` | Soft-delete address |
| `/domains` | List active domains (admin: all) |
| `/help` | Short help |

### Admin commands

| Command | Action |
|---|---|
| `/adduser <chat_id>` | Insert/activate user (multi-user path) |
| `/adddomain <name>` | Insert domain row (DNS still manual in CF) |
| `/offdomain <name>` | Set `domains.active=0` |

### Primary flows

1. **Create:** `/new` → insert address + token → reply with address + actions (inbox/delete)
2. **Push on mail:** after D1 insert, `sendMessage` to `owner_chat_id` with from/subject/OTP hint + `/read <id>`
3. **Read:** body text; verification URLs extracted as clickable links

### OTP heuristic (best-effort)

Prefer 4–8 digit codes near keywords: `verify`, `code`, `otp`, `pin`, `password`. Not guaranteed.

### Bot non-goals v1

Inline WebApp, group chats, channel forward, reply-email.

## 6. Email ingest

```
message → parse To / From / Subject
       → resolve active addresses.address
       → prefer text body; strip/truncate HTML
       → insert mails (body cap ~50KB text)
       → Telegram notify owner
```

- Catch-all routing for each active domain
- Unknown/inactive To → drop + log (no bounce orchestration in v1)
- Telegram notify failure → mail still stored; user uses `/inbox`

## 7. HTTP API

| Method | Path | Auth | Response |
|---|---|---|---|
| `POST` | `/api/new` | `X-API-Key` | `{ id, address, token }` |
| `GET` | `/api/inbox?address=` | `Bearer <address.token>` | list previews |
| `GET` | `/api/mail/:id` | `Bearer <address.token>` | full mail |
| `POST` | `/api/telegram` | Telegram secret token header | webhook updates |
| `GET` | `/health` | none | `ok` |

**Secrets (Worker secrets, never committed)**  
`BOT_TOKEN`, `WEBHOOK_SECRET`, `API_KEY`, optional bootstrap `ALLOWED_CHAT_IDS`.

**Telegram webhook**  
`https://<worker-host>/api/telegram` with `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET`.

**v1.1 (deferred):** AutoCf-compatible aliases (`POST /new_address`, `GET /parsed_mails` with jwt mapping) without changing core tables.

## 8. Security

- Bot commands require active `users` row (and/or bootstrap allowlist env)
- Webhook rejects missing/wrong secret token
- API key for write/create routes; per-address bearer token for inbox read
- Address token: 32-byte hex random
- No unauthenticated listing of all addresses/mails
- Secrets only via `wrangler secret`

## 9. Limits (v1)

| Limit | Value |
|---|---|
| Active addresses per user | 20 |
| Stored mails per address | 100 (FIFO delete oldest) |
| `/new` rate per user | 10 / hour |
| Body truncate | 50KB text |
| Address auto-expire | none (manual `/del`) |

## 10. Error handling

| Case | Behavior |
|---|---|
| Non-whitelist user | “Unauthorized” |
| No active domain | Clear error on `/new` |
| Unknown inbound To | Drop + log |
| Oversized body | Truncate |
| Telegram push fail | Keep D1 row; `/inbox` still works |
| D1 write fail on ingest | Log; accept drop (v1 tradeoff) |
| Bad command | Short `/help` |

## 11. Deploy checklist

1. Buy cheap domain → Cloudflare nameservers
2. Create Worker + D1 + email binding (`wrangler`)
3. Enable CF Email Routing; catch-all → Worker
4. Set secrets: `BOT_TOKEN`, `WEBHOOK_SECRET`, `API_KEY`
5. Run migrations; seed admin `chat_id` + domain row
6. Set Telegram webhook to `/api/telegram`
7. Smoke test: `/new` → send test mail → push + `/read`

## 12. Testing

- **Unit:** OTP regex, local-part generation, auth checks, domain pick
- **Integration (miniflare/wrangler dev):** create address → inject mail row → inbox/read
- **Manual:** real MX path with one live domain

## 13. Multi-domain change procedure

1. Add domain to Cloudflare account; set MX for Email Routing
2. Catch-all → same Worker
3. `/adddomain example.com` (or SQL seed)
4. To retire: `/offdomain old.com` (existing addresses remain readable until `/del`)

## 14. Future (explicitly not v1)

- `MULTI_USER=true` public-ish onboarding UX
- AutoCf mail-adapter compatibility layer
- Auto-expire TTL on addresses
- Outbound mail
- Web dashboard

## 15. Decisions log

| Decision | Choice | Reason |
|---|---|---|
| Hosting | Pure Cloudflare Workers + D1 | User request: no VPS; single vendor |
| Backend DB | D1 not Supabase | Fits pure-CF; less moving parts |
| Primary UX | Telegram bot | User request |
| Access | Private first | Safer default; flag for later |
| Domains | Pluggable multi-domain | User requirement: domain can change |
| Cost path | Cheap domain + free CF tiers | User wanted cheapest self-owned |
| AutoCf bridge | Deferred v1.1 | YAGNI until pipeline needs it |
