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
