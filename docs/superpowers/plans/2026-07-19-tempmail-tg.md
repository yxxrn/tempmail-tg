# tempmail-tg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure-Cloudflare temporary email service with multi-domain support and a private Telegram bot for personal OTP/signup verification.

**Architecture:** One Cloudflare Worker handles (1) CF Email Routing ingest → D1, (2) Telegram webhook bot commands, (3) thin HTTP API. D1 stores domains, addresses, mails, users. Domains are pluggable rows; no VPS.

**Tech Stack:** Cloudflare Workers (TypeScript), D1, Wrangler, Vitest (workers pool), Telegram Bot API HTTP.

**Spec:** `docs/superpowers/specs/2026-07-19-tempmail-tg-design.md`

## Global Constraints

- Pure Cloudflare only (no VPS runtime for bot/API)
- Private whitelist first; `MULTI_USER` env defaults `"false"`
- Multi-domain via `domains` table; domain change = DNS + row, no code change
- No outbound SMTP, no web UI, no AutoCf adapter paths in v1
- Secrets via `wrangler secret` only: `BOT_TOKEN`, `WEBHOOK_SECRET`, `API_KEY`
- Limits: 20 active addresses/user, 100 mails/address FIFO, 10 `/new` per hour/user, 50KB body truncate
- OTP extraction is best-effort regex only
- Language in user-facing bot replies: **Indonesian** (user communicates in ID)
- Commits: small, frequent; TDD where logic is non-trivial
- Package manager: npm
- Node types / Workers: target latest Wrangler 3.x + `@cloudflare/workers-types`

---

## File map

```
tempmail-tg/
  package.json
  tsconfig.json
  wrangler.toml
  vitest.config.ts
  migrations/
    0001_init.sql
  src/
    index.ts                 # fetch + email export handlers
    env.ts                   # Env type
    db.ts                    # D1 helpers
    auth.ts                  # whitelist, API key, address token checks
    ids.ts                   # uuid/token helpers
    otp.ts                   # OTP + URL extract
    mail_parse.ts            # CF ForwardableEmailMessage → fields
    limits.ts                # rate/address/mail caps
    telegram.ts              # sendMessage, answer helpers
    bot.ts                   # command router + handlers
    api.ts                   # HTTP /api/* routes
    email_handler.ts         # inbound email pipeline
  tests/
    otp.test.ts
    ids.test.ts
    auth.test.ts
    db.test.ts
    bot_parse.test.ts
    limits.test.ts
  scripts/
    seed.sql                 # example seed (admin + domain)
  README.md
```

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `.gitignore`, `src/env.ts`, `src/index.ts`
- Test: smoke `npx tsc --noEmit` + `npx vitest run` (empty/pass after stub)

**Interfaces:**
- Produces: `Env` type used by all modules

- [ ] **Step 1: Create package.json**

```json
{
  "name": "tempmail-tg",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:local": "wrangler d1 migrations apply tempmail --local",
    "db:remote": "wrangler d1 migrations apply tempmail --remote"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250317.0",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create wrangler.toml**

```toml
name = "tempmail-tg"
main = "src/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "tempmail"
database_id = "REPLACE_AFTER_CREATE"
migrations_dir = "migrations"

[vars]
MULTI_USER = "false"
# ALLOWED_CHAT_IDS set as secret or var at deploy, comma-separated
ALLOWED_CHAT_IDS = ""

# Email binding configured after first deploy via dashboard or:
# [[send_email]] not needed (inbound only)
```

Note: Email Worker routing is bound in Cloudflare dashboard (Email Routing → Worker). Document in README; `wrangler.toml` may also use:

```toml
# After enabling Email Workers in account, bind in dashboard.
# Local tests mock the email handler directly.
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

If pool-workers setup is painful on first install, fall back to plain Vitest for pure unit tests (otp/ids/limits/auth pure functions) — prefer plain Vitest for Tasks 2–4:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Use **plain Vitest** for unit-only modules; integration with D1 can be manual/`wrangler dev` in later tasks. Simpler = better.

- [ ] **Step 5: Create .gitignore**

```
node_modules/
.wrangler/
.dev.vars
dist/
*.log
.DS_Store
```

- [ ] **Step 6: Create src/env.ts**

```ts
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  API_KEY: string;
  MULTI_USER: string; // "true" | "false"
  ALLOWED_CHAT_IDS: string; // comma-separated bootstrap
}
```

- [ ] **Step 7: Create stub src/index.ts**

```ts
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 8: Install + typecheck**

```bash
cd /home/ubuntu/tempmail-tg
npm install
npx tsc --noEmit
```

Expected: exit 0

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml vitest.config.ts .gitignore src/env.ts src/index.ts
git commit -m "chore: scaffold tempmail-tg worker project"
```

---

### Task 2: IDs + OTP helpers (TDD)

**Files:**
- Create: `src/ids.ts`, `src/otp.ts`, `tests/ids.test.ts`, `tests/otp.test.ts`

**Interfaces:**
- Produces:
  - `randomId(): string` — uuid v4-ish hex
  - `randomToken(): string` — 32-byte hex (64 chars)
  - `randomLocalPart(): string` — 10 lowercase alnum
  - `extractOtp(text: string): string | null`
  - `extractUrls(text: string): string[]`

- [ ] **Step 1: Write failing tests**

`tests/ids.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomId, randomToken, randomLocalPart } from "../src/ids";

describe("ids", () => {
  it("randomId returns 32 hex chars", () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("randomToken returns 64 hex chars", () => {
    const t = randomToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("randomLocalPart is 10 lowercase alnum", () => {
    const p = randomLocalPart();
    expect(p).toMatch(/^[a-z0-9]{10}$/);
  });
});
```

`tests/otp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractOtp, extractUrls } from "../src/otp";

describe("extractOtp", () => {
  it("finds code near keyword", () => {
    expect(extractOtp("Your verification code is 482913. Expires soon.")).toBe("482913");
  });

  it("returns null when no code", () => {
    expect(extractOtp("Hello friend, see you at 12")).toBeNull();
  });

  it("prefers 6-digit OTP", () => {
    expect(extractOtp("OTP: 123456")).toBe("123456");
  });
});

describe("extractUrls", () => {
  it("extracts https links", () => {
    const urls = extractUrls("Click https://example.com/verify?t=abc now");
    expect(urls).toEqual(["https://example.com/verify?t=abc"]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/ids.test.ts tests/otp.test.ts
```

Expected: fail module not found

- [ ] **Step 3: Implement src/ids.ts**

```ts
function bytesToHex(buf: Uint8Array): string {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function randomLocalPart(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join("");
}
```

- [ ] **Step 4: Implement src/otp.ts**

```ts
const OTP_NEAR =
  /(?:verify|verification|code|otp|pin|password|kode)[^\d]{0,20}(\d{4,8})\b/i;
const OTP_LOOSE = /\b(\d{6})\b/;

export function extractOtp(text: string): string | null {
  if (!text) return null;
  const near = text.match(OTP_NEAR);
  if (near?.[1]) return near[1];
  // avoid matching plain times like "12" — only 6-digit loose
  const loose = text.match(OTP_LOOSE);
  return loose?.[1] ?? null;
}

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  return text.match(re) ?? [];
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/ids.test.ts tests/otp.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/ids.ts src/otp.ts tests/ids.test.ts tests/otp.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add id/token generators and OTP/URL extractors"
```

---

### Task 3: D1 schema + db helpers

**Files:**
- Create: `migrations/0001_init.sql`, `src/db.ts`, `tests/db_unit.test.ts` (pure query builders if any; otherwise document manual check)
- Note: D1 integration tests need wrangler; unit-test pure helpers only

**Interfaces:**
- Produces (all async, take `db: D1Database`):
  - `listActiveDomains(db)`
  - `getDomain(db, name)`
  - `addDomain(db, name)`
  - `setDomainActive(db, name, active: boolean)`
  - `createAddress(db, row)`
  - `getAddressByAddress(db, address)`
  - `getAddressById(db, id)`
  - `listAddressesByOwner(db, chatId)`
  - `countActiveAddresses(db, chatId)`
  - `deactivateAddress(db, id, chatId)`
  - `insertMail(db, row)`
  - `listMails(db, addressId, limit)`
  - `getMail(db, id)`
  - `markMailRead(db, id)`
  - `trimMails(db, addressId, keep: number)`
  - `getUser(db, chatId)`
  - `upsertUser(db, chatId, username, role?)`
  - `setUserActive(db, chatId, active)`
  - `countNewAddressSince(db, chatId, isoSince)`

- [ ] **Step 1: Write migration**

`migrations/0001_init.sql`:

```sql
CREATE TABLE domains (
  name TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  owner_chat_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_addresses_owner ON addresses(owner_chat_id);
CREATE INDEX idx_addresses_active ON addresses(active);

CREATE TABLE mails (
  id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  received_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (address_id) REFERENCES addresses(id)
);

CREATE INDEX idx_mails_address ON mails(address_id, received_at);

CREATE TABLE users (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Implement src/db.ts**

```ts
export type DomainRow = { name: string; active: number; created_at: string };
export type AddressRow = {
  id: string;
  address: string;
  local_part: string;
  domain: string;
  owner_chat_id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  active: number;
};
export type MailRow = {
  id: string;
  address_id: string;
  from_addr: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  received_at: string;
  read: number;
};
export type UserRow = {
  chat_id: string;
  username: string | null;
  role: string;
  active: number;
  created_at: string;
};

export async function listActiveDomains(db: D1Database): Promise<DomainRow[]> {
  const r = await db
    .prepare("SELECT * FROM domains WHERE active = 1 ORDER BY name")
    .all<DomainRow>();
  return r.results ?? [];
}

export async function getDomain(
  db: D1Database,
  name: string
): Promise<DomainRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM domains WHERE name = ?")
      .bind(name)
      .first<DomainRow>()) ?? null
  );
}

export async function addDomain(db: D1Database, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO domains (name, active, created_at) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET active = 1"
    )
    .bind(name.toLowerCase(), now)
    .run();
}

export async function setDomainActive(
  db: D1Database,
  name: string,
  active: boolean
): Promise<void> {
  await db
    .prepare("UPDATE domains SET active = ? WHERE name = ?")
    .bind(active ? 1 : 0, name.toLowerCase())
    .run();
}

export async function createAddress(
  db: D1Database,
  row: AddressRow
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO addresses
      (id, address, local_part, domain, owner_chat_id, token, created_at, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.address,
      row.local_part,
      row.domain,
      row.owner_chat_id,
      row.token,
      row.created_at,
      row.expires_at,
      row.active
    )
    .run();
}

export async function getAddressByAddress(
  db: D1Database,
  address: string
): Promise<AddressRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM addresses WHERE address = ?")
      .bind(address.toLowerCase())
      .first<AddressRow>()) ?? null
  );
}

export async function getAddressById(
  db: D1Database,
  id: string
): Promise<AddressRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM addresses WHERE id = ?")
      .bind(id)
      .first<AddressRow>()) ?? null
  );
}

export async function listAddressesByOwner(
  db: D1Database,
  chatId: string
): Promise<AddressRow[]> {
  const r = await db
    .prepare(
      "SELECT * FROM addresses WHERE owner_chat_id = ? AND active = 1 ORDER BY created_at DESC"
    )
    .bind(chatId)
    .all<AddressRow>();
  return r.results ?? [];
}

export async function countActiveAddresses(
  db: D1Database,
  chatId: string
): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM addresses WHERE owner_chat_id = ? AND active = 1"
    )
    .bind(chatId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function deactivateAddress(
  db: D1Database,
  idOrAddress: string,
  chatId: string
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE addresses SET active = 0
       WHERE owner_chat_id = ? AND active = 1
         AND (id = ? OR address = ?)`
    )
    .bind(chatId, idOrAddress, idOrAddress.toLowerCase())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function insertMail(db: D1Database, row: MailRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mails
      (id, address_id, from_addr, subject, body_text, body_html, received_at, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.address_id,
      row.from_addr,
      row.subject,
      row.body_text,
      row.body_html,
      row.received_at,
      row.read
    )
    .run();
}

export async function listMails(
  db: D1Database,
  addressId: string,
  limit = 10
): Promise<MailRow[]> {
  const r = await db
    .prepare(
      "SELECT * FROM mails WHERE address_id = ? ORDER BY received_at DESC LIMIT ?"
    )
    .bind(addressId, limit)
    .all<MailRow>();
  return r.results ?? [];
}

export async function getMail(
  db: D1Database,
  id: string
): Promise<MailRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM mails WHERE id = ?")
      .bind(id)
      .first<MailRow>()) ?? null
  );
}

export async function markMailRead(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE mails SET read = 1 WHERE id = ?").bind(id).run();
}

export async function trimMails(
  db: D1Database,
  addressId: string,
  keep: number
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM mails WHERE address_id = ? AND id NOT IN (
         SELECT id FROM mails WHERE address_id = ?
         ORDER BY received_at DESC LIMIT ?
       )`
    )
    .bind(addressId, addressId, keep)
    .run();
}

export async function getUser(
  db: D1Database,
  chatId: string
): Promise<UserRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM users WHERE chat_id = ?")
      .bind(chatId)
      .first<UserRow>()) ?? null
  );
}

export async function upsertUser(
  db: D1Database,
  chatId: string,
  username: string | null,
  role = "user"
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (chat_id, username, role, active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(chat_id) DO UPDATE SET username = excluded.username, active = 1`
    )
    .bind(chatId, username, role, now)
    .run();
}

export async function setUserActive(
  db: D1Database,
  chatId: string,
  active: boolean
): Promise<void> {
  await db
    .prepare("UPDATE users SET active = ? WHERE chat_id = ?")
    .bind(active ? 1 : 0, chatId)
    .run();
}

export async function countNewAddressSince(
  db: D1Database,
  chatId: string,
  isoSince: string
): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM addresses WHERE owner_chat_id = ? AND created_at >= ?"
    )
    .bind(chatId, isoSince)
    .first<{ c: number }>();
  return r?.c ?? 0;
}
```

- [ ] **Step 3: Write a pure smoke test for types/export**

`tests/db_exports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as db from "../src/db";

describe("db exports", () => {
  it("exports expected functions", () => {
    expect(typeof db.createAddress).toBe("function");
    expect(typeof db.listActiveDomains).toBe("function");
    expect(typeof db.insertMail).toBe("function");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/db_exports.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/0001_init.sql src/db.ts tests/db_exports.test.ts
git commit -m "feat: add D1 schema and database helpers"
```

---

### Task 4: Auth + limits (TDD)

**Files:**
- Create: `src/auth.ts`, `src/limits.ts`, `tests/auth.test.ts`, `tests/limits.test.ts`

**Interfaces:**
- Produces:
  - `isBootstrapAllowed(env, chatId): boolean`
  - `async assertUser(env, chatId): Promise<{ok:true, user}|{ok:false, reason}>`
  - `async assertAdmin(env, chatId): ...`
  - `checkApiKey(env, request): boolean`
  - `checkWebhookSecret(env, request): boolean`
  - `MAX_ADDRESSES = 20`, `MAX_MAILS = 100`, `MAX_NEW_PER_HOUR = 10`, `BODY_MAX = 50_000`
  - `truncateBody(text): string`
  - `hourAgoIso(): string`

- [ ] **Step 1: Write tests**

`tests/limits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { truncateBody, BODY_MAX } from "../src/limits";

describe("truncateBody", () => {
  it("leaves short text", () => {
    expect(truncateBody("hi")).toBe("hi");
  });
  it("truncates long text", () => {
    const s = "a".repeat(BODY_MAX + 100);
    const out = truncateBody(s);
    expect(out.length).toBe(BODY_MAX);
  });
});
```

`tests/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isBootstrapAllowed, checkApiKey, checkWebhookSecret } from "../src/auth";
import type { Env } from "../src/env";

const baseEnv = {
  DB: {} as D1Database,
  BOT_TOKEN: "t",
  WEBHOOK_SECRET: "whsec",
  API_KEY: "apikey",
  MULTI_USER: "false",
  ALLOWED_CHAT_IDS: "111,222",
} as Env;

describe("isBootstrapAllowed", () => {
  it("allows listed chat", () => {
    expect(isBootstrapAllowed(baseEnv, "111")).toBe(true);
  });
  it("denies unlisted", () => {
    expect(isBootstrapAllowed(baseEnv, "999")).toBe(false);
  });
});

describe("checkApiKey", () => {
  it("accepts matching header", () => {
    const req = new Request("https://x/api/new", {
      headers: { "X-API-Key": "apikey" },
    });
    expect(checkApiKey(baseEnv, req)).toBe(true);
  });
  it("rejects missing", () => {
    expect(checkApiKey(baseEnv, new Request("https://x"))).toBe(false);
  });
});

describe("checkWebhookSecret", () => {
  it("accepts telegram secret header", () => {
    const req = new Request("https://x/api/telegram", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "whsec" },
    });
    expect(checkWebhookSecret(baseEnv, req)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npx vitest run tests/auth.test.ts tests/limits.test.ts
```

- [ ] **Step 3: Implement src/limits.ts**

```ts
export const MAX_ADDRESSES = 20;
export const MAX_MAILS = 100;
export const MAX_NEW_PER_HOUR = 10;
export const BODY_MAX = 50_000;

export function truncateBody(text: string): string {
  if (!text) return "";
  return text.length > BODY_MAX ? text.slice(0, BODY_MAX) : text;
}

export function hourAgoIso(now = Date.now()): string {
  return new Date(now - 60 * 60 * 1000).toISOString();
}
```

- [ ] **Step 4: Implement src/auth.ts**

```ts
import type { Env } from "./env";
import { getUser, type UserRow } from "./db";

export function isBootstrapAllowed(env: Env, chatId: string): boolean {
  const list = (env.ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(chatId);
}

export function checkApiKey(env: Env, request: Request): boolean {
  const key = request.headers.get("X-API-Key") || "";
  return !!env.API_KEY && key === env.API_KEY;
}

export function checkWebhookSecret(env: Env, request: Request): boolean {
  const t = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  return !!env.WEBHOOK_SECRET && t === env.WEBHOOK_SECRET;
}

export async function assertUser(
  env: Env,
  chatId: string
): Promise<{ ok: true; user: UserRow | null } | { ok: false; reason: string }> {
  if (isBootstrapAllowed(env, chatId)) {
    const user = await getUser(env.DB, chatId);
    return { ok: true, user };
  }
  const user = await getUser(env.DB, chatId);
  if (user && user.active === 1) return { ok: true, user };
  return { ok: false, reason: "Unauthorized" };
}

export async function assertAdmin(
  env: Env,
  chatId: string
): Promise<{ ok: true; user: UserRow | null } | { ok: false; reason: string }> {
  const base = await assertUser(env, chatId);
  if (!base.ok) return base;
  if (isBootstrapAllowed(env, chatId)) return base;
  if (base.user?.role === "admin" && base.user.active === 1) return base;
  return { ok: false, reason: "Admin only" };
}
```

- [ ] **Step 5: Run — PASS**

```bash
npx vitest run tests/auth.test.ts tests/limits.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/limits.ts tests/auth.test.ts tests/limits.test.ts
git commit -m "feat: add auth checks and usage limits"
```

---

### Task 5: Telegram client + command parser

**Files:**
- Create: `src/telegram.ts`, `src/bot_parse.ts`, `tests/bot_parse.test.ts`

**Interfaces:**
- Produces:
  - `sendMessage(env, chatId, text, extra?)`
  - `parseCommand(text): { cmd: string; args: string[] } | null`

- [ ] **Step 1: Write parse tests**

```ts
import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/bot_parse";

describe("parseCommand", () => {
  it("parses /new", () => {
    expect(parseCommand("/new")).toEqual({ cmd: "new", args: [] });
  });
  it("parses /new with domain and bot suffix", () => {
    expect(parseCommand("/new@MyBot example.com")).toEqual({
      cmd: "new",
      args: ["example.com"],
    });
  });
  it("returns null for non-command", () => {
    expect(parseCommand("hello")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement bot_parse.ts**

```ts
export function parseCommand(
  text: string | undefined
): { cmd: string; args: string[] } | null {
  if (!text || !text.startsWith("/")) return null;
  const parts = text.trim().split(/\s+/);
  const head = parts[0].slice(1).split("@")[0].toLowerCase();
  return { cmd: head, args: parts.slice(1) };
}
```

- [ ] **Step 3: Implement telegram.ts**

```ts
import type { Env } from "./env";

export async function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("telegram sendMessage fail", res.status, body);
  }
}
```

- [ ] **Step 4: Run tests PASS + commit**

```bash
npx vitest run tests/bot_parse.test.ts
git add src/telegram.ts src/bot_parse.ts tests/bot_parse.test.ts
git commit -m "feat: telegram client and command parser"
```

---

### Task 6: Bot command handlers

**Files:**
- Create: `src/bot.ts`
- Modify: none yet

**Interfaces:**
- Consumes: db.*, auth.*, ids.*, otp.*, limits.*, telegram.*, parseCommand
- Produces: `handleTelegramUpdate(env, update): Promise<void>`

- [ ] **Step 1: Implement src/bot.ts** (full handlers)

```ts
import type { Env } from "./env";
import { parseCommand } from "./bot_parse";
import { sendMessage } from "./telegram";
import {
  assertAdmin,
  assertUser,
  isBootstrapAllowed,
} from "./auth";
import {
  addDomain,
  countActiveAddresses,
  countNewAddressSince,
  createAddress,
  deactivateAddress,
  getAddressByAddress,
  getAddressById,
  getMail,
  getUser,
  listActiveDomains,
  listAddressesByOwner,
  listMails,
  markMailRead,
  setDomainActive,
  upsertUser,
} from "./db";
import { randomId, randomLocalPart, randomToken } from "./ids";
import {
  hourAgoIso,
  MAX_ADDRESSES,
  MAX_NEW_PER_HOUR,
} from "./limits";
import { extractOtp, extractUrls } from "./otp";

type TgUpdate = {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
};

export async function handleTelegramUpdate(
  env: Env,
  update: TgUpdate
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const username = msg.from?.username ?? null;
  const parsed = parseCommand(msg.text);
  if (!parsed) {
    await sendMessage(env, chatId, "Kirim /help untuk daftar perintah.");
    return;
  }

  const auth = await assertUser(env, chatId);
  if (!auth.ok && parsed.cmd !== "start" && parsed.cmd !== "help") {
    await sendMessage(env, chatId, "Unauthorized.");
    return;
  }

  // Bootstrap: first /start from allowlist creates admin user
  if (parsed.cmd === "start") {
    if (!auth.ok && !isBootstrapAllowed(env, chatId)) {
      await sendMessage(env, chatId, "Unauthorized.");
      return;
    }
    if (isBootstrapAllowed(env, chatId)) {
      await upsertUser(env.DB, chatId, username, "admin");
    } else if (auth.ok) {
      await upsertUser(env.DB, chatId, username, auth.user?.role ?? "user");
    }
    await sendMessage(
      env,
      chatId,
      "tempmail-tg siap.\n/new — buat alamat\n/list — daftar alamat\n/inbox — mail terbaru\n/read <id> — baca mail\n/del <alamat|id> — hapus alamat\n/domains — domain aktif\n/help"
    );
    return;
  }

  if (parsed.cmd === "help") {
    await sendMessage(
      env,
      chatId,
      "/new [domain]\n/list\n/inbox [alamat|id]\n/read <mail_id>\n/del <alamat|id>\n/domains\nAdmin: /adduser /adddomain /offdomain"
    );
    return;
  }

  if (!auth.ok) {
    await sendMessage(env, chatId, "Unauthorized.");
    return;
  }

  switch (parsed.cmd) {
    case "new":
      await cmdNew(env, chatId, parsed.args[0]);
      return;
    case "list":
      await cmdList(env, chatId);
      return;
    case "inbox":
      await cmdInbox(env, chatId, parsed.args[0]);
      return;
    case "read":
      await cmdRead(env, chatId, parsed.args[0]);
      return;
    case "del":
      await cmdDel(env, chatId, parsed.args[0]);
      return;
    case "domains":
      await cmdDomains(env, chatId);
      return;
    case "adduser":
      await cmdAddUser(env, chatId, parsed.args[0]);
      return;
    case "adddomain":
      await cmdAddDomain(env, chatId, parsed.args[0]);
      return;
    case "offdomain":
      await cmdOffDomain(env, chatId, parsed.args[0]);
      return;
    default:
      await sendMessage(env, chatId, "Perintah tidak dikenal. /help");
  }
}

async function cmdNew(env: Env, chatId: string, domainArg?: string) {
  const n = await countActiveAddresses(env.DB, chatId);
  if (n >= MAX_ADDRESSES) {
    await sendMessage(env, chatId, `Batas ${MAX_ADDRESSES} alamat aktif.`);
    return;
  }
  const recent = await countNewAddressSince(env.DB, chatId, hourAgoIso());
  if (recent >= MAX_NEW_PER_HOUR) {
    await sendMessage(env, chatId, `Batas ${MAX_NEW_PER_HOUR} /new per jam.`);
    return;
  }

  let domain = domainArg?.toLowerCase();
  if (domain) {
    const d = await listActiveDomains(env.DB);
    if (!d.find((x) => x.name === domain)) {
      await sendMessage(env, chatId, `Domain tidak aktif: ${domain}`);
      return;
    }
  } else {
    const domains = await listActiveDomains(env.DB);
    if (!domains.length) {
      await sendMessage(env, chatId, "No active domain. Admin: /adddomain");
      return;
    }
    domain = domains[Math.floor(Math.random() * domains.length)].name;
  }

  const local = randomLocalPart();
  const address = `${local}@${domain}`;
  const id = randomId();
  const token = randomToken();
  const now = new Date().toISOString();
  await createAddress(env.DB, {
    id,
    address,
    local_part: local,
    domain,
    owner_chat_id: chatId,
    token,
    created_at: now,
    expires_at: null,
    active: 1,
  });
  await sendMessage(
    env,
    chatId,
    `Alamat baru:\n\`${address}\`\n\nid: ${id}\n/inbox ${address}`
  );
}

async function cmdList(env: Env, chatId: string) {
  const rows = await listAddressesByOwner(env.DB, chatId);
  if (!rows.length) {
    await sendMessage(env, chatId, "Belum ada alamat. /new");
    return;
  }
  const lines = rows.map((r) => `• ${r.address} (${r.id.slice(0, 8)})`);
  await sendMessage(env, chatId, lines.join("\n"));
}

async function resolveOwnedAddress(
  env: Env,
  chatId: string,
  key?: string
) {
  if (!key) {
    const list = await listAddressesByOwner(env.DB, chatId);
    return list[0] ?? null;
  }
  const byId = await getAddressById(env.DB, key);
  if (byId && byId.owner_chat_id === chatId && byId.active === 1) return byId;
  const byAddr = await getAddressByAddress(env.DB, key);
  if (byAddr && byAddr.owner_chat_id === chatId && byAddr.active === 1)
    return byAddr;
  return null;
}

async function cmdInbox(env: Env, chatId: string, key?: string) {
  const addr = await resolveOwnedAddress(env, chatId, key);
  if (!addr) {
    await sendMessage(env, chatId, "Alamat tidak ditemukan.");
    return;
  }
  const mails = await listMails(env.DB, addr.id, 10);
  if (!mails.length) {
    await sendMessage(env, chatId, `Inbox kosong: ${addr.address}`);
    return;
  }
  const lines = mails.map((m) => {
    const otp = extractOtp(m.body_text) || extractOtp(m.subject);
    const otpHint = otp ? ` OTP:${otp}` : "";
    return `• ${m.id.slice(0, 8)} | ${m.from_addr} | ${m.subject}${otpHint}\n  /read ${m.id}`;
  });
  await sendMessage(env, chatId, `${addr.address}\n${lines.join("\n")}`);
}

async function cmdRead(env: Env, chatId: string, mailId?: string) {
  if (!mailId) {
    await sendMessage(env, chatId, "Pakai: /read <mail_id>");
    return;
  }
  const mail = await getMail(env.DB, mailId);
  if (!mail) {
    await sendMessage(env, chatId, "Mail tidak ada.");
    return;
  }
  const addr = await getAddressById(env.DB, mail.address_id);
  if (!addr || addr.owner_chat_id !== chatId) {
    await sendMessage(env, chatId, "Mail tidak ada.");
    return;
  }
  await markMailRead(env.DB, mail.id);
  const otp = extractOtp(mail.body_text) || extractOtp(mail.subject);
  const urls = extractUrls(mail.body_text);
  let text = `Dari: ${mail.from_addr}\nSubj: ${mail.subject}\n\n${mail.body_text.slice(0, 3500)}`;
  if (otp) text += `\n\nOTP: ${otp}`;
  if (urls.length) text += `\n\nLinks:\n${urls.slice(0, 5).join("\n")}`;
  await sendMessage(env, chatId, text);
}

async function cmdDel(env: Env, chatId: string, key?: string) {
  if (!key) {
    await sendMessage(env, chatId, "Pakai: /del <alamat|id>");
    return;
  }
  const ok = await deactivateAddress(env.DB, key, chatId);
  await sendMessage(env, chatId, ok ? "Alamat dinonaktifkan." : "Gagal / tidak ketemu.");
}

async function cmdDomains(env: Env, chatId: string) {
  const admin = await assertAdmin(env, chatId);
  // non-admin: active only (listActiveDomains); admin same for v1 simplicity
  const rows = await listActiveDomains(env.DB);
  if (!rows.length) {
    await sendMessage(env, chatId, "Tidak ada domain aktif.");
    return;
  }
  await sendMessage(
    env,
    chatId,
    rows.map((d) => `• ${d.name}`).join("\n") +
      (admin.ok ? "\n\nAdmin: /adddomain /offdomain" : "")
  );
}

async function cmdAddUser(env: Env, chatId: string, target?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (env.MULTI_USER !== "true") {
    await sendMessage(
      env,
      chatId,
      "MULTI_USER=false. Set env MULTI_USER=true untuk mengaktifkan."
    );
    return;
  }
  if (!target) {
    await sendMessage(env, chatId, "Pakai: /adduser <chat_id>");
    return;
  }
  await upsertUser(env.DB, target, null, "user");
  await sendMessage(env, chatId, `User ${target} diaktifkan.`);
}

async function cmdAddDomain(env: Env, chatId: string, name?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (!name) {
    await sendMessage(env, chatId, "Pakai: /adddomain example.com");
    return;
  }
  await addDomain(env.DB, name);
  await sendMessage(
    env,
    chatId,
    `Domain ${name.toLowerCase()} aktif di DB.\nPastikan MX Email Routing CF sudah di-set.`
  );
}

async function cmdOffDomain(env: Env, chatId: string, name?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (!name) {
    await sendMessage(env, chatId, "Pakai: /offdomain example.com");
    return;
  }
  await setDomainActive(env.DB, name, false);
  await sendMessage(env, chatId, `Domain ${name.toLowerCase()} nonaktif.`);
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0 (fix any import typos)

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: telegram bot command handlers"
```

---

### Task 7: Email ingest handler

**Files:**
- Create: `src/mail_parse.ts`, `src/email_handler.ts`
- Test: `tests/mail_parse.test.ts` for HTML strip / address extract pure parts

**Interfaces:**
- Produces:
  - `stripHtml(html: string): string`
  - `async handleInboundEmail(env, message: ForwardableEmailMessage): Promise<void>`

- [ ] **Step 1: Test stripHtml**

```ts
import { describe, it, expect } from "vitest";
import { stripHtml } from "../src/mail_parse";

describe("stripHtml", () => {
  it("removes tags", () => {
    expect(stripHtml("<p>Hi <b>there</b></p>")).toContain("Hi");
    expect(stripHtml("<p>Hi</p>")).not.toContain("<p>");
  });
});
```

- [ ] **Step 2: Implement mail_parse.ts**

```ts
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmailAddr(raw: string): string {
  // "Name <user@dom.com>" or bare
  const m = raw.match(/<([^>]+)>/);
  const addr = (m?.[1] || raw).trim().toLowerCase();
  return addr.replace(/^mailto:/, "");
}
```

- [ ] **Step 3: Implement email_handler.ts**

```ts
import type { Env } from "./env";
import {
  getAddressByAddress,
  insertMail,
  trimMails,
} from "./db";
import { randomId } from "./ids";
import { BODY_MAX, MAX_MAILS, truncateBody } from "./limits";
import { normalizeEmailAddr, stripHtml } from "./mail_parse";
import { extractOtp } from "./otp";
import { sendMessage } from "./telegram";

// CF Email Workers type (subset)
export interface InboundEmail {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  text?: () => Promise<string>; // may not exist; use PostalMime if needed
}

/**
 * Cloudflare Email Routing worker handler.
 * Prefer postal-mime for robust parse; v1 uses headers + raw text fallback.
 */
export async function handleInboundEmail(
  env: Env,
  message: ForwardableEmailMessage
): Promise<void> {
  const toHeader = message.headers.get("to") || message.to || "";
  const fromHeader = message.headers.get("from") || message.from || "";
  const subject = message.headers.get("subject") || "(no subject)";

  // Extract primary recipient address
  const candidates = toHeader.split(",").map(normalizeEmailAddr);
  let addressRow = null as Awaited<ReturnType<typeof getAddressByAddress>>;
  for (const c of candidates) {
    addressRow = await getAddressByAddress(env.DB, c);
    if (addressRow && addressRow.active === 1) break;
    addressRow = null;
  }
  // Also try message.to
  if (!addressRow && message.to) {
    addressRow = await getAddressByAddress(
      env.DB,
      normalizeEmailAddr(message.to)
    );
    if (addressRow && addressRow.active !== 1) addressRow = null;
  }

  if (!addressRow) {
    console.log("drop mail: unknown to", toHeader);
    return;
  }

  let bodyText = "";
  let bodyHtml: string | null = null;

  // Parse with postal-mime (add dependency)
  try {
    const { default: PostalMime } = await import("postal-mime");
    const parser = new PostalMime();
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parser.parse(raw);
    bodyText = parsed.text || "";
    bodyHtml = parsed.html || null;
    if (!bodyText && bodyHtml) bodyText = stripHtml(bodyHtml);
  } catch (e) {
    console.error("parse fail", e);
    bodyText = `(parse failed) subject=${subject}`;
  }

  bodyText = truncateBody(bodyText);
  if (bodyHtml && bodyHtml.length > BODY_MAX) {
    bodyHtml = bodyHtml.slice(0, BODY_MAX);
  }

  const mailId = randomId();
  const now = new Date().toISOString();
  await insertMail(env.DB, {
    id: mailId,
    address_id: addressRow.id,
    from_addr: normalizeEmailAddr(fromHeader) || fromHeader,
    subject,
    body_text: bodyText,
    body_html: bodyHtml,
    received_at: now,
    read: 0,
  });
  await trimMails(env.DB, addressRow.id, MAX_MAILS);

  const otp = extractOtp(bodyText) || extractOtp(subject);
  const preview = [
    `📩 ${addressRow.address}`,
    `Dari: ${normalizeEmailAddr(fromHeader) || fromHeader}`,
    `Subj: ${subject}`,
    otp ? `OTP: ${otp}` : null,
    `/read ${mailId}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendMessage(env, addressRow.owner_chat_id, preview);
}
```

- [ ] **Step 4: Add postal-mime dependency**

```bash
npm install postal-mime
```

Add to package.json dependencies (runtime).

- [ ] **Step 5: Tests + typecheck + commit**

```bash
npx vitest run tests/mail_parse.test.ts
npx tsc --noEmit
git add src/mail_parse.ts src/email_handler.ts tests/mail_parse.test.ts package.json package-lock.json
git commit -m "feat: inbound email parse, store, telegram push"
```

---

### Task 8: HTTP API routes

**Files:**
- Create: `src/api.ts`

**Interfaces:**
- Produces: `handleApi(request, env): Promise<Response | null>` — null if not an API path

- [ ] **Step 1: Implement src/api.ts**

```ts
import type { Env } from "./env";
import { checkApiKey, checkWebhookSecret } from "./auth";
import {
  countActiveAddresses,
  countNewAddressSince,
  createAddress,
  getAddressByAddress,
  getMail,
  listActiveDomains,
  listMails,
} from "./db";
import { randomId, randomLocalPart, randomToken } from "./ids";
import {
  hourAgoIso,
  MAX_ADDRESSES,
  MAX_NEW_PER_HOUR,
} from "./limits";
import { handleTelegramUpdate } from "./bot";

export async function handleApi(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health") {
    return new Response("ok");
  }

  if (path === "/api/telegram" && request.method === "POST") {
    if (!checkWebhookSecret(env, request)) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    await handleTelegramUpdate(env, update);
    return new Response("ok");
  }

  if (path === "/api/new" && request.method === "POST") {
    if (!checkApiKey(env, request)) {
      return new Response("unauthorized", { status: 401 });
    }
    let body: { domain?: string; owner_chat_id?: string } = {};
    try {
      body = await request.json();
    } catch {
      /* empty */
    }
    const owner = body.owner_chat_id || env.ALLOWED_CHAT_IDS.split(",")[0]?.trim();
    if (!owner) {
      return Response.json({ error: "owner_chat_id required" }, { status: 400 });
    }
    if ((await countActiveAddresses(env.DB, owner)) >= MAX_ADDRESSES) {
      return Response.json({ error: "address limit" }, { status: 429 });
    }
    if (
      (await countNewAddressSince(env.DB, owner, hourAgoIso())) >=
      MAX_NEW_PER_HOUR
    ) {
      return Response.json({ error: "rate limit" }, { status: 429 });
    }
    let domain = body.domain?.toLowerCase();
    const domains = await listActiveDomains(env.DB);
    if (!domains.length) {
      return Response.json({ error: "no active domain" }, { status: 400 });
    }
    if (domain && !domains.find((d) => d.name === domain)) {
      return Response.json({ error: "domain inactive" }, { status: 400 });
    }
    if (!domain) {
      domain = domains[Math.floor(Math.random() * domains.length)].name;
    }
    const local = randomLocalPart();
    const address = `${local}@${domain}`;
    const id = randomId();
    const token = randomToken();
    await createAddress(env.DB, {
      id,
      address,
      local_part: local,
      domain,
      owner_chat_id: owner,
      token,
      created_at: new Date().toISOString(),
      expires_at: null,
      active: 1,
    });
    return Response.json({ id, address, token });
  }

  if (path === "/api/inbox" && request.method === "GET") {
    const address = url.searchParams.get("address") || "";
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const row = await getAddressByAddress(env.DB, address);
    if (!row || row.token !== token || row.active !== 1) {
      return new Response("unauthorized", { status: 401 });
    }
    const mails = await listMails(env.DB, row.id, 20);
    return Response.json(
      mails.map((m) => ({
        id: m.id,
        from: m.from_addr,
        subject: m.subject,
        received_at: m.received_at,
        preview: m.body_text.slice(0, 200),
      }))
    );
  }

  if (path.startsWith("/api/mail/") && request.method === "GET") {
    const id = path.slice("/api/mail/".length);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const mail = await getMail(env.DB, id);
    if (!mail) return new Response("not found", { status: 404 });
    const { getAddressById } = await import("./db");
    const addr = await getAddressById(env.DB, mail.address_id);
    if (!addr || addr.token !== token) {
      return new Response("unauthorized", { status: 401 });
    }
    return Response.json(mail);
  }

  return null;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/api.ts
git commit -m "feat: HTTP API for new/inbox/mail/telegram webhook"
```

---

### Task 9: Wire index.ts (fetch + email)

**Files:**
- Modify: `src/index.ts`
- Modify: `wrangler.toml` (document email)

- [ ] **Step 1: Replace src/index.ts**

```ts
import type { Env } from "./env";
import { handleApi } from "./api";
import { handleInboundEmail } from "./email_handler";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const apiRes = await handleApi(request, env);
      if (apiRes) return apiRes;
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error(e);
      return new Response("error", { status: 500 });
    }
  },

  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    try {
      await handleInboundEmail(env, message);
    } catch (e) {
      console.error("email handler error", e);
    }
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Run full unit tests**

```bash
npx vitest run
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire fetch and email entrypoints"
```

---

### Task 10: Seed script + README deploy guide

**Files:**
- Create: `scripts/seed.sql`, `README.md`, `.dev.vars.example`

- [ ] **Step 1: scripts/seed.sql**

```sql
-- Replace CHAT_ID and domain before applying
INSERT INTO users (chat_id, username, role, active, created_at)
VALUES ('REPLACE_CHAT_ID', 'admin', 'admin', 1, datetime('now'))
ON CONFLICT(chat_id) DO UPDATE SET role = 'admin', active = 1;

INSERT INTO domains (name, active, created_at)
VALUES ('example.com', 1, datetime('now'))
ON CONFLICT(name) DO UPDATE SET active = 1;
```

- [ ] **Step 2: .dev.vars.example**

```
BOT_TOKEN=123:ABC
WEBHOOK_SECRET=long-random
API_KEY=long-random
ALLOWED_CHAT_IDS=123456789
MULTI_USER=false
```

- [ ] **Step 3: README.md** (concise deploy)

```markdown
# tempmail-tg

Self-owned temp mail + Telegram bot on Cloudflare Workers + D1.

## Spec / Plan

- `docs/superpowers/specs/2026-07-19-tempmail-tg-design.md`
- `docs/superpowers/plans/2026-07-19-tempmail-tg.md`

## Setup

1. `npm install`
2. Create D1: `npx wrangler d1 create tempmail` → paste `database_id` into `wrangler.toml`
3. `cp .dev.vars.example .dev.vars` and fill secrets for local
4. `npm run db:local`
5. Create bot via @BotFather → `BOT_TOKEN`
6. Domain on Cloudflare → Email Routing → enable catch-all → send to Worker `tempmail-tg`
7. Deploy: `npx wrangler secret put BOT_TOKEN` (and WEBHOOK_SECRET, API_KEY)
8. Set var `ALLOWED_CHAT_IDS` to your Telegram chat id
9. `npm run db:remote` + seed admin/domain
10. `npx wrangler deploy`
11. Set webhook:
    ```bash
    curl "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
      -d "url=https://tempmail-tg.<subdomain>.workers.dev/api/telegram" \
      -d "secret_token=$WEBHOOK_SECRET"
    ```
12. Telegram: `/start` → `/adddomain your.domain` → `/new`

## Multi-domain

Add MX/Email Routing for each domain to same Worker, then `/adddomain`.

## API

- `POST /api/new` header `X-API-Key`
- `GET /api/inbox?address=` header `Authorization: Bearer <token>`
- `GET /api/mail/:id` same bearer
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.sql README.md .dev.vars.example
git commit -m "docs: deploy guide, seed SQL, dev vars example"
```

---

### Task 11: Final verification

**Files:** none new

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all green

- [ ] **Step 2: Manual checklist (requires real CF account — operator)**

1. D1 created + migrations remote
2. Secrets set
3. Domain MX + Email Routing catch-all → worker
4. Webhook set
5. `/start` → `/adddomain` → `/new` → send test email to address → push received → `/read`

- [ ] **Step 3: Final commit if any fixups**

```bash
git status
# commit fixups if needed
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Pure CF Worker + D1 + Email Routing | 1, 7, 9, 10 |
| Multi-domain pluggable | 3, 6 (`/adddomain`/`/offdomain`) |
| Private whitelist + MULTI_USER later | 4, 6 |
| Bot commands /new /list /inbox /read /del /domains | 6 |
| Admin /adduser /adddomain /offdomain | 6 |
| Email ingest + Telegram push + OTP | 2, 7 |
| HTTP API new/inbox/mail/telegram/health | 8, 9 |
| Limits 20 / 100 / 10/h / 50KB | 4, 6, 7, 8 |
| Secrets not in repo | 1, 10 |
| No outbound SMTP / web UI / AutoCf v1 | omitted (YAGNI) |
| Indonesian bot copy | 6 |
| Tests for OTP/ids/auth/limits/parse | 2, 4, 5, 7 |

**Placeholder scan:** none intentional.  
**Type consistency:** `Env`, `AddressRow`, `MailRow`, `UserRow` shared via `env.ts` / `db.ts`.

**Note for implementer:** `ForwardableEmailMessage` is a Cloudflare type; ensure `@cloudflare/workers-types` includes Email Workers. If `postal-mime` default import fails under Workers, switch to `import PostalMime from "postal-mime"`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-19-tempmail-tg.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, executing-plans, batch with checkpoints  

Which approach?
