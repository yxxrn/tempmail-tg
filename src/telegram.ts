import type { Env } from "./env";

// ── Types ──────────────────────────────────────────────────────────────────

export type InlineButton = {
  text: string;
  data?: string; // callback_data for InlineKeyboardButton
  url?: string;
  copy?: string; // text to copy (simulated via description)
};

export type InlineRow = InlineButton[];

export type MessageExtra = {
  reply_markup?: {
    inline_keyboard: InlineRow[];
  };
  parse_mode?: "HTML" | "MarkdownV2";
};

// ── Core sender ──────────────────────────────────────────────────────────────

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

// ── Convenience senders ──────────────────────────────────────────────────────

/** Send with inline keyboard buttons. callback_data uses prefix:action:id */
export async function sendWithInline(
  env: Env,
  chatId: string | number,
  text: string,
  rows: InlineRow[],
  parseMode?: "HTML" | "MarkdownV2"
): Promise<void> {
  await sendMessage(env, chatId, text, {
    reply_markup: { inline_keyboard: rows },
    parse_mode: parseMode,
  });
}

/** Edit existing message's inline keyboard (for callback responses) */
export async function editMessageReplyMarkup(
  env: Env,
  chatId: string | number,
  messageId: number,
  rows?: InlineRow[]
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageReplyMarkup`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
  };
  if (rows) {
    body.reply_markup = { inline_keyboard: rows };
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Answer a callback query (dismiss popup or show alert) */
export async function answerCb(
  env: Env,
  cbId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text, show_alert: showAlert }),
  });
}

/** Edit message text + inline keyboard */
export async function editMessageText(
  env: Env,
  chatId: string | number,
  messageId: number,
  text: string,
  rows?: InlineRow[],
  parseMode?: "HTML" | "MarkdownV2"
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    parse_mode: parseMode,
  };
  if (rows) {
    body.reply_markup = { inline_keyboard: rows };
  }
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Send a chat action (typing / uploading) */
export async function sendAction(
  env: Env,
  chatId: string | number,
  action: "typing" | "upload_document" = "typing"
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

// ── Bot command menu registration ─────────────────────────────────────────────

const COMMANDS = [
  { command: "start", description: "🚀 Start / Welcome" },
  { command: "new", description: "✨ New email address" },
  { command: "list", description: "📋 My addresses" },
  { command: "inbox", description: "📥 Inbox" },
  { command: "read", description: "📖 Read mail" },
  { command: "del", description: "🗑️ Delete address" },
  { command: "domains", description: "🌐 Active domains" },
  { command: "me", description: "👤 My profile" },
  { command: "stats", description: "📊 Usage stats" },
  { command: "help", description: "❓ Help" },
] as const;

export async function registerBotCommands(env: Env): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: COMMANDS }),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function fmt(code: string): string {
  return `<code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`;
}

export function fmtBold(text: string): string {
  return `<b>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b>`;
}

export function fmtLink(label: string, url: string): string {
  return `<a href="${url}">${label}</a>`;
}

/** Parse mode string for sendWithInline */
export type ParseMode = "HTML" | "MarkdownV2";
