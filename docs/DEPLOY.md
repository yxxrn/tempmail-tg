# Deploy guide — tempmail-tg

## Prasyarat

- Akun Cloudflare
- Domain di Cloudflare (zone Active)
- Bot dari @BotFather
- Node 18+ / npm
- Wrangler (`npm i` sudah include)

## Checklist production

### A. Cloudflare Worker + D1

```bash
npm install
npx wrangler login
npx wrangler d1 create tempmail
```

Edit `wrangler.toml`:

- `database_id` dari output create
- `ALLOWED_CHAT_IDS = "YOUR_TELEGRAM_CHAT_ID"`
- `MULTI_USER = "false"` (default)

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # random panjang, simpan
npx wrangler secret put API_KEY          # random panjang, simpan
npm run db:remote
npx wrangler deploy
```

Catat URL Worker, contoh:

`https://tempmail-tg.<subdomain>.workers.dev`

Jika belum ada workers.dev subdomain, register sekali di dashboard Workers.

### B. Telegram webhook

```bash
export BOT_TOKEN=...
export WEBHOOK_SECRET=...
export WORKER_URL=https://tempmail-tg.<subdomain>.workers.dev

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${WORKER_URL}/api/telegram" \
  -d "secret_token=${WEBHOOK_SECRET}" \
  -d "drop_pending_updates=true"

curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

### C. Domain + Email Routing

Per domain:

1. Zone Active di CF
2. **Email → Email Routing → Enable** (MX `route1/2/3.mx.cloudflare.net`)
3. **Routing rules → Catch-all**:
   - Action: **Send to a Worker**
   - Worker: **`tempmail-tg`**
   - Enabled: on
4. Bot: `/adddomain your.domain`  
   atau SQL:

```sql
INSERT INTO domains (name, active, created_at)
VALUES ('your.domain', 1, datetime('now'))
ON CONFLICT(name) DO UPDATE SET active = 1;
```

### D. Bootstrap admin

1. Set `ALLOWED_CHAT_IDS` ke chat id kamu
2. Redeploy / update var di dashboard
3. Kirim `/start` ke bot → harus dapat help, bukan Unauthorized

Dapatkan chat id: chat bot dulu; bila unauthorized, bot menampilkan `chat_id: …`.

Seed alternatif:

```bash
npx wrangler d1 execute tempmail --remote --command \
  "INSERT INTO users (chat_id, username, role, active, created_at)
   VALUES ('CHAT_ID', 'admin', 'admin', 1, datetime('now'))
   ON CONFLICT(chat_id) DO UPDATE SET role='admin', active=1;"
```

### E. Smoke test

1. `curl $WORKER_URL/health` → `ok`
2. `/new` di bot → alamat `@domain`
3. Kirim email real ke alamat itu
4. Push masuk + `/read`

## Permission API token CF (opsional automation)

Minimal untuk deploy Worker/D1:

- Account → Workers Scripts: Edit
- Account → D1: Edit

Untuk DNS/Email Routing via API:

- Zone → DNS: Edit
- Zone → Email Routing Rules / Addresses: Edit
- Zone Resources: include domain

## Update deploy

```bash
git pull
npm install
npx wrangler deploy
# migrasi baru jika ada:
npm run db:remote
```

## Multi-user (opsional)

1. Set `MULTI_USER = "true"` di vars + redeploy
2. Admin: `/adduser <chat_id>`

## Keamanan produksi

- Jangan commit `wrangler.toml` dengan chat id pribadi jika repo public — gunakan dashboard vars
- Rotate secrets yang pernah terekspos
- Repo public: biarkan `database_id` / `ALLOWED_CHAT_IDS` sebagai placeholder; isi di environment deploy masing-masing
