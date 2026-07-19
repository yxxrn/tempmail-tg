# Panduan pengguna — tempmail-tg

## Siapa ini untuk

Personal: signup / OTP / link verifikasi lewat alamat email sementara, dikontrol dari Telegram.

## Syarat

1. Bot Telegram (sudah di-deploy + webhook)
2. Chat id kamu ada di whitelist (`ALLOWED_CHAT_IDS` atau admin seed)
3. Minimal 1 domain aktif di bot (`/domains`)
4. Domain itu punya **Email Routing** CF catch-all → Worker `tempmail-tg`

## Alur harian

### Buat alamat

```
/new
```

Contoh balasan: `` `abc12xyz99@your.domain` ``

Pilih domain tertentu:

```
/new your.domain
```

### Daftar alamat

```
/list
```

### Tunggu mail

Saat email masuk, bot push ringkasan (from, subject, OTP jika ketemu) + perintah `/read <id>`.

### Baca full

```
/read <mail_id>
```

### Inbox manual

```
/inbox
/inbox alamat@domain
```

### Hapus alamat

```
/del alamat@domain
```

Soft-delete: mail lama tetap di DB sampai trim; alamat tidak terima mail baru.

## Admin

Hanya bootstrap allowlist / role `admin`.

| Command | Efek |
|---|---|
| `/domains` | List domain aktif |
| `/adddomain example.com` | Aktifkan domain di DB (DNS/MX tetap manual di CF) |
| `/offdomain example.com` | Domain tidak dipakai `/new` |
| `/adduser <chat_id>` | Hanya jika `MULTI_USER=true` |

## Multi-domain & random

- `/new` **tanpa argumen** → random domain dari yang `active=1`
- Satu domain saja → selalu domain itu (local-part tetap random)
- Domain cadangan: beli/setup CF → catch-all Worker sama → `/adddomain`

## Tips

- Jangan pakai temp mail untuk bank / recovery akun penting
- Jika situs tolak domain, `/offdomain` + domain cadangan
- OTP deteksi best-effort; kalau gagal, buka `/read` full body
- Rate limit: max 10 `/new` / jam, max 20 alamat aktif

## Troubleshooting

| Gejala | Cek |
|---|---|
| Unauthorized | chat id belum di whitelist; `/start` harusnya balas chat_id |
| No active domain | `/adddomain` + pastikan domain di D1 |
| `/new` OK, mail tidak masuk | MX Email Routing + catch-all Worker enabled |
| Push gagal, mail ada | `/inbox` masih bisa; cek `BOT_TOKEN` |
| Domain pending di CF | NS belum propaga; tunggu sampai zone Active |
