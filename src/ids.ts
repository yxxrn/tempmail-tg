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
