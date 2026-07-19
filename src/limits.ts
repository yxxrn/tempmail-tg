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
