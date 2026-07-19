# tempmail-tg

Self-owned **temporary email** + **Telegram bot**, fully on **Cloudflare Workers + D1**.

Buat alamat disposable (`user@your-domain`), terima OTP/link verifikasi, baca lewat Telegram. Multi-domain (bisa diganti tanpa rewrite bot). Private whitelist dulu; multi-user opsional.

## Fitur

- `/new` — alamat random di domain aktif (atau `/new domain.com`)
- Push Telegram saat mail masuk + deteksi OTP/link (best-effort)
- `/inbox`, `/read`, `/list`, `/del`
- Multi-domain: `/adddomain` / `/offdomain` (admin)
- HTTP API: create address + baca inbox (token per alamat)
- Pure Cloudflare — no VPS untuk runtime bot/API

## Arsitektur

```
Situs/OTP ──MX──► Cloudflare Email Routing (catch-all)
                        │
                        ▼
              Worker tempmail-tg  ──►  D1
                        ▲
              Telegram webhook ──┘
```

## Command bot

| Command | Aksi |
|---|---|
| `/start` | Auth + help |
| `/new [domain]` | Buat alamat temp |
| `/list` | Alamat aktif milikmu |
| `/inbox [alamat\|id]` | 10 mail terakhir |
| `/read <mail_id>` | Isi mail + OTP/link |
| `/del <alamat\|id>` | Soft-delete alamat |
| `/domains` | Domain aktif |
| `/adddomain` `/offdomain` `/adduser` | Admin |

## Limit (v1)

- 20 alamat aktif / user
- 100 mail / alamat (FIFO)
- 10 `/new` per jam / user
- Body truncate 50KB

## Setup cepat

### 1. Clone & install

```bash
git clone https://github.com/yxxrn/tempmail-tg.git
cd tempmail-tg
npm install
```

### 2. Cloudflare login + D1

```bash
npx wrangler login
npx wrangler d1 create tempmail
```

Paste `database_id` ke `wrangler.toml` → `[[d1_databases]].database_id`.

### 3. Secrets & vars

```bash
cp .dev.vars.example .dev.vars
# isi BOT_TOKEN, WEBHOOK_SECRET, API_KEY, ALLOWED_CHAT_IDS

npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put API_KEY
```

Set `ALLOWED_CHAT_IDS` (Telegram chat id kamu) di `wrangler.toml` `[vars]` atau dashboard Worker.

### 4. Migrasi D1

```bash
npm run db:local    # dev
npm run db:remote   # production
# opsional seed:
# edit scripts/seed.sql lalu:
# npx wrangler d1 execute tempmail --remote --file=scripts/seed.sql
```

### 5. Domain + Email Routing

1. Domain di Cloudflare (NS aktif)
2. **Email** → **Email Routing** → Enable (MX otomatis)
3. **Catch-all** → **Send to a Worker** → `tempmail-tg` → Enable

### 6. Deploy + webhook

```bash
npx wrangler deploy
```

```bash
curl "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d "url=https://tempmail-tg.<subdomain>.workers.dev/api/telegram" \
  -d "secret_token=$WEBHOOK_SECRET"
```

### 7. Pakai

Telegram bot → `/start` → `/adddomain your.domain` → `/new`

## Multi-domain

1. Domain baru ke CF + Email Routing catch-all → **Worker yang sama**
2. Bot: `/adddomain other.com`
3. `/new` memilih **random** dari domain aktif
4. Nonaktif: `/offdomain old.com`

Tidak perlu beli domain kedua kecuali butuh cadangan / domain kena block.

## HTTP API

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | — |
| `POST` | `/api/new` | `X-API-Key` |
| `GET` | `/api/inbox?address=` | `Authorization: Bearer <address.token>` |
| `GET` | `/api/mail/:id` | Bearer token alamat |
| `POST` | `/api/telegram` | `X-Telegram-Bot-Api-Secret-Token` |

`POST /api/new` body opsional:

```json
{ "domain": "example.com", "owner_chat_id": "123456789" }
```

## Dev

```bash
npm test
npm run typecheck
npm run dev
```

## Struktur

```
src/
  index.ts          # fetch + email entrypoints
  bot.ts            # Telegram commands
  email_handler.ts  # inbound mail → D1 → push
  api.ts            # HTTP routes
  db.ts             # D1 helpers
  auth.ts / limits.ts / otp.ts / ids.ts
migrations/
  0001_init.sql
docs/superpowers/
  specs/…-design.md
  plans/…-tempmail-tg.md
```

## Dokumentasi lengkap

| File | Isi |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Panduan pakai bot + multi-domain |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploy & checklist production |
| [docs/API.md](docs/API.md) | Referensi HTTP API |
| [docs/superpowers/specs/2026-07-19-tempmail-tg-design.md](docs/superpowers/specs/2026-07-19-tempmail-tg-design.md) | Design spec |
| [docs/superpowers/plans/2026-07-19-tempmail-tg.md](docs/superpowers/plans/2026-07-19-tempmail-tg.md) | Implementation plan |

## Keamanan

- Jangan commit `.dev.vars`, secrets, atau chat id produksi
- Secrets hanya lewat `wrangler secret`
- Bot private: whitelist `ALLOWED_CHAT_IDS` + table `users`
- Rotate token BotFather / CF API token jika pernah bocor di chat

## License

MIT
