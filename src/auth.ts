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
