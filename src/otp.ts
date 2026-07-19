const OTP_NEAR =
  /(?:verify|verification|code|otp|pin|password|kode)[^\d]{0,20}(\d{4,8})\b/i;
const OTP_LOOSE = /\b(\d{6})\b/;

export function extractOtp(text: string): string | null {
  if (!text) return null;
  const near = text.match(OTP_NEAR);
  if (near?.[1]) return near[1];
  const loose = text.match(OTP_LOOSE);
  return loose?.[1] ?? null;
}

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  return text.match(re) ?? [];
}
