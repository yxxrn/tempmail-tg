import type { Env } from "./env";
import { getAddressByAddress, insertMail, trimMails } from "./db";
import { randomId } from "./ids";
import { BODY_MAX, MAX_MAILS, truncateBody } from "./limits";
import { normalizeEmailAddr, stripHtml } from "./mail_parse";
import { extractOtp } from "./otp";
import { sendMessage, sendWithInline } from "./telegram";
import type { InlineRow } from "./telegram";
import PostalMime from "postal-mime";

export async function handleInboundEmail(
  env: Env,
  message: ForwardableEmailMessage
): Promise<void> {
  const toHeader = message.headers.get("to") || message.to || "";
  const fromHeader = message.headers.get("from") || message.from || "";
  const subject = message.headers.get("subject") || "(no subject)";

  const candidates = toHeader.split(",").map(normalizeEmailAddr);
  let addressRow = null as Awaited<ReturnType<typeof getAddressByAddress>>;
  for (const c of candidates) {
    const row = await getAddressByAddress(env.DB, c);
    if (row && row.active === 1) {
      addressRow = row;
      break;
    }
  }
  if (!addressRow && message.to) {
    const row = await getAddressByAddress(
      env.DB,
      normalizeEmailAddr(message.to)
    );
    if (row && row.active === 1) addressRow = row;
  }

  if (!addressRow) {
    console.log("drop mail: unknown to", toHeader);
    return;
  }

  let bodyText = "";
  let bodyHtml: string | null = null;

  try {
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
  const receivedTime = new Date(now).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const text = [
    "📩 <b>Mail Baru!</b>",
    "",
    `📧 <code>${addressRow.address}</code>`,
    "",
    `👤 Dari: <code>${normalizeEmailAddr(fromHeader) || fromHeader}</code>`,
    `📌 Subj: ${subject}`,
    `🕐 ${receivedTime}`,
    otp ? `\n🔑 <b>OTP:</b> <code>${otp}</code>` : "",
  ].join("\n");

  const rows: InlineRow[] = [
    [{ text: `📖 Baca Mail`, data: `mail:read:${mailId}` }],
    [{ text: "📥 Lihat Inbox", data: `addr:inbox:${addressRow.id}` }],
    [{ text: "📋 /list", data: "start:list" }],
  ];

  await sendWithInline(env, addressRow.owner_chat_id, text, rows, "HTML");
}
