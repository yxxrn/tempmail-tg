export function parseCommand(
  text: string | undefined
): { cmd: string; args: string[] } | null {
  if (!text || !text.startsWith("/")) return null;
  const parts = text.trim().split(/\s+/);
  const head = parts[0].slice(1).split("@")[0].toLowerCase();
  return { cmd: head, args: parts.slice(1) };
}
