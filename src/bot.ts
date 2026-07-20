import type { Env } from "./env";
import { parseCommand } from "./bot_parse";
import {
  sendMessage,
  sendWithInline,
  editMessageText,
  answerCb,
  registerBotCommands,
  fmt,
  fmtBold,
} from "./telegram";
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
  listActiveDomains,
  listAddressesByOwner,
  listMails,
  markMailRead,
  setDomainActive,
  upsertUser,
  getUser,
} from "./db";
import { randomId, randomLocalPart, randomToken } from "./ids";
import {
  hourAgoIso,
  MAX_ADDRESSES,
  MAX_NEW_PER_HOUR,
} from "./limits";
import { extractOtp, extractUrls } from "./otp";
import type { InlineRow } from "./telegram";

// ── Callback data prefixes ─────────────────────────────────────────────────
// Format: "prefix:data"  e.g. "addr:del:abc123"

// ── Types ──────────────────────────────────────────────────────────────────

type TgUpdate = {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
  edited_message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number };
    message?: {
      chat: { id: number };
      message_id: number;
      text?: string;
    };
    data?: string;
  };
};

// ── Entry ──────────────────────────────────────────────────────────────────

export async function handleTelegramUpdate(
  env: Env,
  update: TgUpdate
): Promise<void> {
  // Callback query
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }

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

  // Bootstrap /start always allowed
  if (parsed.cmd === "start") {
    await cmdStart(env, chatId, username, auth);
    return;
  }

  if (!auth.ok) {
    await sendMessage(env, chatId, "⛔ Unauthorized.");
    return;
  }

  switch (parsed.cmd) {
    case "help":   await cmdHelp(env, chatId, auth); return;
    case "new":    await cmdNew(env, chatId, parsed.args[0]); return;
    case "list":   await cmdList(env, chatId); return;
    case "inbox":  await cmdInbox(env, chatId, parsed.args[0]); return;
    case "read":   await cmdRead(env, chatId, parsed.args[0]); return;
    case "del":    await cmdDel(env, chatId, parsed.args[0]); return;
    case "domains": await cmdDomains(env, chatId, auth); return;
    case "adduser": await cmdAddUser(env, chatId, parsed.args[0]); return;
    case "adddomain": await cmdAddDomain(env, chatId, parsed.args[0]); return;
    case "offdomain": await cmdOffDomain(env, chatId, parsed.args[0]); return;
    case "me":     await cmdMe(env, chatId, auth); return;
    case "stats":  await cmdStats(env, chatId, auth); return;
    default:
      await sendMessage(env, chatId, "❓ Perintah tidak dikenal. /help");
  }
}

// ── Startup: register commands once ────────────────────────────────────────

let _registered = false;
export async function ensureRegistered(env: Env): Promise<void> {
  if (_registered) return;
  _registered = true;
  try {
    await registerBotCommands(env);
  } catch (e) {
    console.error("registerBotCommands failed", e);
    _registered = false; // retry next time
  }
}

// ── /start ─────────────────────────────────────────────────────────────────

async function cmdStart(env: Env, chatId: string, username: string | null, auth: Awaited<ReturnType<typeof assertUser>>) {
  // Register on first run
  if (!auth.ok && isBootstrapAllowed(env, chatId)) {
    await upsertUser(env.DB, chatId, username, "admin");
    await ensureRegistered(env);
  } else if (auth.ok) {
    await upsertUser(env.DB, chatId, username, auth.user?.role ?? "user");
    await ensureRegistered(env);
  }

  const text = [
    "👋 <b>Selamat datang di tempmail-tg!</b>",
    "",
    "Buat alamat email sementara di domain milikmu sendiri. 📧",
    "Terima OTP, link verifikasi — langsung di Telegram ini. 🔔",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📌 <b>Cara pakai:</b>",
    "",
    "1️⃣  <code>/new</code>  —  Buat alamat baru",
    "2️⃣  <code>/inbox</code>  —  Lihat mail terbaru",
    "3️⃣  <code>/read &lt;id&gt;</code>  —  Baca mail",
    "4️⃣  <code>/list</code>  —  Semua alamatmu",
    "5️⃣  <code>/me</code>  —  Profil &amp; statistik",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "Admin: <code>/adddomain</code> · <code>/domains</code>",
  ].join("\n");

  const rows: InlineRow[] = [
    [{ text: "✨ Buat Alamat Baru", data: "start:new" }],
    [{ text: "📋 Daftar Alamat", data: "start:list" }],
    [{ text: "📥 Inbox", data: "start:inbox" }],
    [{ text: "👤 Profil Saya", data: "start:me" }],
    [{ text: "❓ Help", data: "start:help" }],
  ];

  await sendWithInline(env, chatId, text, rows, "HTML");
}

// ── /help ──────────────────────────────────────────────────────────────────

async function cmdHelp(env: Env, chatId: string, auth: Awaited<ReturnType<typeof assertUser>>) {
  const isAdmin = auth.ok && auth.user?.role === "admin";
  const text = [
    "📖 <b>Daftar Perintah</b>",
    "",
    "<code>/new [domain]</code>  ✨  Buat alamat baru",
    "<code>/list</code>           📋  Daftar alamat aktif",
    "<code>/inbox [alamat]</code>  📥  Lihat inbox",
    "<code>/read &lt;mail_id&gt;</code>    📖  Baca mail",
    "<code>/del [alamat|id]</code>  🗑️  Hapus alamat",
    "<code>/me</code>              👤  Profil saya",
    "<code>/stats</code>           📊  Statistik penggunaan",
    "<code>/domains</code>         🌐  Domain aktif",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "Admin only:",
    "<code>/adduser &lt;chat_id&gt;</code>",
    "<code>/adddomain &lt;domain&gt;</code>",
    "<code>/offdomain &lt;domain&gt;</code>",
  ].join("\n");

  const rows: InlineRow[] = [
    [{ text: "✨ /new", data: "start:new" }],
    [{ text: "📋 /list", data: "start:list" }],
    [{ text: "📥 /inbox", data: "start:inbox" }],
    [{ text: "👤 /me", data: "start:me" }],
  ];
  await sendWithInline(env, chatId, text, rows, "HTML");
}

// ── /new ──────────────────────────────────────────────────────────────────

async function cmdNew(env: Env, chatId: string, domainArg?: string) {
  const n = await countActiveAddresses(env.DB, chatId);
  if (n >= MAX_ADDRESSES) {
    await sendMessage(env, chatId,
      `🛑 Batas tercapai! Maksimum ${MAX_ADDRESSES} alamat aktif.\n\nHapus alamat lama dulu: /list`);
    return;
  }
  const recent = await countNewAddressSince(env.DB, chatId, hourAgoIso());
  if (recent >= MAX_NEW_PER_HOUR) {
    await sendMessage(env, chatId,
      `⚠️ Rate limit. Maksimum ${MAX_NEW_PER_HOUR} alamat baru per jam.`);
    return;
  }

  let domain = domainArg?.toLowerCase();
  if (domain) {
    const d = await listActiveDomains(env.DB);
    if (!d.find((x) => x.name === domain)) {
      await sendMessage(env, chatId, `❌ Domain tidak aktif: <code>${domain}</code>\n\n/listdomain untuk melihat domain aktif.`);
      return;
    }
  } else {
    const domains = await listActiveDomains(env.DB);
    if (!domains.length) {
      await sendMessage(env, chatId, "🌐 Tidak ada domain aktif.\n\nAdmin: /adddomain &lt;domain&gt;");
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

  const text = [
    "✅ <b>Alamat baru berhasil dibuat!</b>",
    "",
    `📧 <code>${address}</code>`,
    "",
    `🔑 ID: <code>${id.slice(0, 12)}</code>`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `📥 Cek inbox: /inbox ${address}`,
    `🗑️  Hapus: /del ${address}`,
  ].join("\n");

  const rows: InlineRow[] = [
    [{ text: "📥 Buka Inbox", data: `addr:inbox:${id}` }],
    [{ text: "🗑️ Hapus Alamat", data: `addr:del:${id}` }],
    [{ text: "✨ Buat Lagi", data: "start:new" }],
  ];

  await sendWithInline(env, chatId, text, rows, "HTML");
}

// ── /list ─────────────────────────────────────────────────────────────────

async function cmdList(env: Env, chatId: string) {
  const rows = await listAddressesByOwner(env.DB, chatId);
  if (!rows.length) {
    const text = [
      "📭 <b>Belum ada alamat.</b>",
      "",
      "Tekan tombol di bawah untuk buat yang pertama! 🎉",
    ].join("\n");
    const r: InlineRow[] = [[{ text: "✨ Buat Alamat Baru", data: "start:new" }]];
    await sendWithInline(env, chatId, text, r, "HTML");
    return;
  }

  // Group rows in pairs for the keyboard
  const text = `📋 <b>Daftar Alamat</b> (${rows.length}/${MAX_ADDRESSES})\n\nTekan tombol untuk aksi:`;

  const keyboard: InlineRow[] = rows.map((r) => [
    { text: `📧 ${r.address}`, data: `addr:view:${r.id}` },
    { text: "🗑️", data: `addr:del:${r.id}` },
  ]);

  await sendWithInline(env, chatId, text, keyboard, "HTML");
}

// ── /inbox ────────────────────────────────────────────────────────────────

async function cmdInbox(env: Env, chatId: string, key?: string) {
  const addr = await resolveOwnedAddress(env, chatId, key);
  if (!addr) {
    const text = "❌ <b>Alamat tidak ditemukan.</b>\n\n/list untuk lihat alamat aktif.";
    const r: InlineRow[] = [[{ text: "📋 /list", data: "start:list" }]];
    await sendWithInline(env, chatId, text, r, "HTML");
    return;
  }
  await showInbox(env, chatId, addr.id, addr.address);
}

async function showInbox(
  env: Env,
  chatId: string | number,
  addressId: string,
  addressStr: string,
  messageId?: number
) {
  const mails = await listMails(env.DB, addressId, 15);
  const addr = await getAddressById(env.DB, addressId);

  if (!mails.length) {
    const text = [
      `📭 <b>Inbox kosong</b>`,
      `📧 <code>${addressStr}</code>`,
      "",
      "Mail yang masuk akan muncul di sini. 🔔",
    ].join("\n");
    const rows: InlineRow[] = [
      [{ text: "✨ /new", data: "start:new" }],
      [{ text: "📋 /list", data: "start:list" }],
    ];
    if (messageId) {
      await editMessageText(env, chatId, messageId, text, rows, "HTML");
    } else {
      await sendWithInline(env, chatId, text, rows, "HTML");
    }
    return;
  }

  const text = [
    `📥 <b>Inbox</b>`,
    `📧 <code>${addressStr}</code>`,
    "",
    ...mails.map((m) => {
      const otp = extractOtp(m.body_text) || extractOtp(m.subject);
      const badge = otp ? ` 🔑${otp}` : "";
      const read = m.read ? "" : " 🔴";
      return `• <code>${m.id.slice(0, 8)}</code> ${m.from_addr}${badge}${read}`;
    }),
  ].join("\n");

  const keyboard: InlineRow[] = mails.map((m) => [
    { text: `📖 ${m.id.slice(0, 8)} · ${m.subject.slice(0, 25)}`, data: `mail:read:${m.id}` },
    { text: m.read ? "✅" : "🔴", data: `mail:read:${m.id}` },
  ]);
  keyboard.push([{ text: "🔄 Refresh", data: `addr:inbox:${addressId}` }]);
  keyboard.push([{ text: "📋 /list", data: "start:list" }]);

  if (messageId) {
    await editMessageText(env, chatId, messageId, text, keyboard, "HTML");
  } else {
    await sendWithInline(env, chatId, text, keyboard, "HTML");
  }
}

// ── /read ─────────────────────────────────────────────────────────────────

async function cmdRead(env: Env, chatId: string, mailId?: string) {
  if (!mailId) {
    await sendMessage(env, chatId, "📖 Pakai: <code>/read &lt;mail_id&gt;</code>\n\n/inbox untuk lihat daftar mail.");
    return;
  }
  const mail = await getMail(env.DB, mailId);
  if (!mail) {
    await sendMessage(env, chatId, "❌ Mail tidak ditemukan.");
    return;
  }
  const addr = await getAddressById(env.DB, mail.address_id);
  if (!addr || addr.owner_chat_id !== chatId) {
    await sendMessage(env, chatId, "❌ Mail tidak ditemukan.");
    return;
  }
  await showMail(env, chatId, mail.id, addr.address);
}

async function showMail(
  env: Env,
  chatId: string | number,
  mailId: string,
  addressStr: string,
  messageId?: number
) {
  const mail = await getMail(env.DB, mailId);
  if (!mail) {
    const text = "❌ Mail sudah dihapus atau tidak ada.";
    if (messageId) {
      await editMessageText(env, chatId, messageId, text, [], "HTML");
    } else {
      await sendMessage(env, chatId, text);
    }
    return;
  }
  await markMailRead(env.DB, mail.id);

  const otp = extractOtp(mail.body_text) || extractOtp(mail.subject);
  const urls = extractUrls(mail.body_text);

  const preview = mail.body_text.slice(0, 3200);

  let text = [
    `📩 <b>Mail</b>`,
    `📧 <code>${addressStr}</code>`,
    "",
    `👤 Dari: <code>${mail.from_addr}</code>`,
    `📌 Subj: ${mail.subject}`,
    `🕐 ${new Date(mail.received_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    preview,
  ].join("\n");

  const rows: InlineRow[] = [];
  if (otp) {
    text += `\n\n🔑 <b>OTP Terdeteksi:</b> <code>${otp}</code>`;
    rows.push([{ text: `📋 Salin OTP: ${otp}`, copy: otp }]);
  }
  if (urls.length) {
    const urlRows: InlineRow[] = urls.slice(0, 5).map((u) => [
      { text: "🔗 Link", url: u },
    ]);
    rows.push(...urlRows);
  }
  rows.push([{ text: "📥 Inbox", data: `addr:inbox:${mail.address_id}` }]);
  rows.push([{ text: "📋 /list", data: "start:list" }]);

  if (messageId) {
    await editMessageText(env, chatId, messageId, text, rows, "HTML");
  } else {
    await sendWithInline(env, chatId, text, rows, "HTML");
  }
}

// ── /del — interactive selector ────────────────────────────────────────────

async function cmdDel(env: Env, chatId: string, key?: string) {
  if (!key) {
    // Show interactive selector
    await showDelSelector(env, chatId);
    return;
  }
  const ok = await deactivateAddress(env.DB, key, chatId);
  if (ok) {
    await sendMessage(env, chatId, `🗑️ Alamat <code>${key}</code> berhasil dihapus.`);
  } else {
    await sendMessage(env, chatId, "❌ Gagal menghapus. Alamat tidak ditemukan atau bukan milikmu.");
  }
}

async function showDelSelector(env: Env, chatId: string | number) {
  const rows = await listAddressesByOwner(env.DB, String(chatId));
  if (!rows.length) {
    await sendMessage(env, chatId, "📭 Tidak ada alamat untuk dihapus.\n\n/new untuk buat baru.");
    return;
  }

  const text = [
    "🗑️ <b>Hapus Alamat</b>",
    "",
    "Pilih alamat yang ingin dihapus:",
  ].join("\n");

  const keyboard: InlineRow[] = rows.map((r) => [
    { text: `📧 ${r.address}`, data: `addr:del:${r.id}` },
  ]);
  keyboard.push([{ text: "❌ Batal", data: "start:list" }]);

  await sendWithInline(env, chatId, text, keyboard, "HTML");
}

// ── /domains ───────────────────────────────────────────────────────────────

async function cmdDomains(env: Env, chatId: string, auth: Awaited<ReturnType<typeof assertUser>>) {
  const admin = await assertAdmin(env, chatId);
  const rows = await listActiveDomains(env.DB);
  if (!rows.length) {
    await sendMessage(env, chatId, "🌐 Tidak ada domain aktif.\n\nAdmin: /adddomain");
    return;
  }
  const list = rows.map((d) => `✅ <code>${d.name}</code>`).join("\n");
  const text = [
    `🌐 <b>Domain Aktif</b> (${rows.length})`,
    "",
    list,
    "",
    admin.ok ? "Admin: /adddomain · /offdomain" : "",
  ].join("\n");
  const rows2: InlineRow[] = admin.ok
    ? [
        [{ text: "➕ Tambah Domain", data: "start:adddomain" }],
      ]
    : [];
  await sendWithInline(env, chatId, text, rows2, "HTML");
}

// ── /me ───────────────────────────────────────────────────────────────────

async function cmdMe(env: Env, chatId: string, auth: Awaited<ReturnType<typeof assertUser>>) {
  const user = await getUser(env.DB, chatId);
  const addrCount = await countActiveAddresses(env.DB, chatId);
  const recent = await countNewAddressSince(env.DB, chatId, hourAgoIso());

  const roleBadge = auth.ok && auth.user?.role === "admin" ? "👑 Admin" : "👤 User";

  const text = [
    "👤 <b>Profil Saya</b>",
    "",
    `🆔 Chat ID: <code>${chatId}</code>`,
    `🏷️ Role: ${roleBadge}`,
    user?.username ? `📛 Username: @${user.username}` : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `📧 Alamat aktif: <b>${addrCount}</b> / ${MAX_ADDRESSES}`,
    `✨ Dibuat 1 jam terakhir: <b>${recent}</b> / ${MAX_NEW_PER_HOUR}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📌 Tips: Ketik /new untuk alamat baru, /list untuk melihat semua.",
  ].filter(Boolean).join("\n");

  const keyboard: InlineRow[] = [
    [{ text: "📋 /list", data: "start:list" }],
    [{ text: "📥 /inbox", data: "start:inbox" }],
    [{ text: "✨ /new", data: "start:new" }],
  ];
  await sendWithInline(env, chatId, text, keyboard, "HTML");
}

// ── /stats ────────────────────────────────────────────────────────────────

async function cmdStats(env: Env, chatId: string, auth: Awaited<ReturnType<typeof assertUser>>) {
  const addrCount = await countActiveAddresses(env.DB, chatId);
  const addresses = await listAddressesByOwner(env.DB, chatId);
  const since = hourAgoIso();
  const recent = await countNewAddressSince(env.DB, chatId, since);

  // Count total mails per address
  let totalMails = 0;
  for (const a of addresses) {
    const mails = await listMails(env.DB, a.id, 1000);
    totalMails += mails.length;
  }

  const text = [
    "📊 <b>Statistik Penggunaan</b>",
    "",
    `📧 Alamat aktif: <b>${addrCount}</b> / ${MAX_ADDRESSES}`,
    `📩 Total mail diterima: <b>${totalMails}</b>`,
    `⚡ Rate (1 jam): <b>${recent}</b> / ${MAX_NEW_PER_HOUR}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    addresses.length
      ? addresses.map((a) => {
          const short = a.id.slice(0, 8);
          return `• <code>${a.address}</code> (${short})`;
        }).join("\n")
      : "Belum ada alamat.",
  ].join("\n");

  const keyboard: InlineRow[] = [
    [{ text: "📥 Lihat Inbox", data: "start:inbox" }],
    [{ text: "📋 /list", data: "start:list" }],
  ];
  await sendWithInline(env, chatId, text, keyboard, "HTML");
}

// ── Admin: /adduser ────────────────────────────────────────────────────────

async function cmdAddUser(env: Env, chatId: string, target?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (env.MULTI_USER !== "true") {
    await sendMessage(env, chatId, "⚙️ MULTI_USER=false. Set env MULTI_USER=true untuk mengaktifkan multi-user.");
    return;
  }
  if (!target) {
    await sendMessage(env, chatId, "👤 Pakai: <code>/adduser &lt;chat_id&gt;</code>");
    return;
  }
  await upsertUser(env.DB, target, null, "user");
  await sendMessage(env, chatId, `✅ User <code>${target}</code> diaktifkan.`);
}

// ── Admin: /adddomain ─────────────────────────────────────────────────────

async function cmdAddDomain(env: Env, chatId: string, name?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (!name) {
    await sendMessage(env, chatId, "🌐 Pakai: <code>/adddomain example.com</code>");
    return;
  }
  await addDomain(env.DB, name);
  const text = [
    `✅ Domain <code>${name.toLowerCase()}</code> aktif di DB.`,
    "",
    "📌 Pastikan MX Email Routing Cloudflare sudah di-point ke Worker ini.",
  ].join("\n");
  await sendMessage(env, chatId, text);
}

// ── Admin: /offdomain ─────────────────────────────────────────────────────

async function cmdOffDomain(env: Env, chatId: string, name?: string) {
  const admin = await assertAdmin(env, chatId);
  if (!admin.ok) {
    await sendMessage(env, chatId, admin.reason);
    return;
  }
  if (!name) {
    await sendMessage(env, chatId, "🌐 Pakai: <code>/offdomain example.com</code>");
    return;
  }
  await setDomainActive(env.DB, name, false);
  await sendMessage(env, chatId, `🔴 Domain <code>${name.toLowerCase()}</code> nonaktif.`);
}

// ── Callback handler ───────────────────────────────────────────────────────

async function handleCallback(
  env: Env,
  cb: NonNullable<TgUpdate["callback_query"]>
): Promise<void> {
  const chatId = String(cb.message?.chat.id ?? 0);
  const messageId = cb.message?.message_id ?? 0;
  const data = cb.data ?? "";
  const auth = await assertUser(env, chatId);

  if (!auth.ok) {
    await answerCb(env, cb.id, "⛔ Unauthorized.", true);
    return;
  }

  // ── start: ────────────────────────────────────────────────────────────
  if (data === "start:new") {
    await answerCb(env, cb.id);
    await cmdNew(env, chatId);
    return;
  }
  if (data === "start:list") {
    await answerCb(env, cb.id);
    await cmdList(env, chatId);
    return;
  }
  if (data === "start:inbox") {
    await answerCb(env, cb.id);
    await cmdInbox(env, chatId);
    return;
  }
  if (data === "start:me") {
    await answerCb(env, cb.id);
    await cmdMe(env, chatId, auth);
    return;
  }
  if (data === "start:help") {
    await answerCb(env, cb.id);
    await cmdHelp(env, chatId, auth);
    return;
  }
  if (data === "start:adddomain") {
    await answerCb(env, cb.id);
    await sendMessage(env, chatId, "🌐 Pakai: <code>/adddomain example.com</code>");
    return;
  }

  // ── addr: ─────────────────────────────────────────────────────────────
  if (data.startsWith("addr:view:")) {
    const addrId = data.slice("addr:view:".length);
    await answerCb(env, cb.id);
    await showInbox(env, chatId, addrId, "", messageId);
    return;
  }
  if (data.startsWith("addr:inbox:")) {
    const addrId = data.slice("addr:inbox:".length);
    const addr = await getAddressById(env.DB, addrId);
    await answerCb(env, cb.id);
    await showInbox(env, chatId, addrId, addr?.address ?? "");
    return;
  }
  if (data.startsWith("addr:del:")) {
    const addrId = data.slice("addr:del:".length);
    const addr = await getAddressById(env.DB, addrId);
    if (!addr || addr.owner_chat_id !== chatId) {
      await answerCb(env, cb.id, "❌ Alamat tidak ditemukan.", true);
      return;
    }
    await answerCb(env, cb.id, `🗑️ Menghapus ${addr.address}...`, true);
    await deactivateAddress(env.DB, addrId, chatId);
    await editMessageText(env, chatId, messageId,
      `✅ <code>${addr.address}</code> berhasil dihapus.`, [], "HTML");
    return;
  }

  // ── mail: ─────────────────────────────────────────────────────────────
  if (data.startsWith("mail:read:")) {
    const mailId = data.slice("mail:read:".length);
    const mail = await getMail(env.DB, mailId);
    if (!mail) {
      await answerCb(env, cb.id, "❌ Mail tidak ditemukan.", true);
      return;
    }
    const addr = await getAddressById(env.DB, mail.address_id);
    if (!addr || addr.owner_chat_id !== chatId) {
      await answerCb(env, cb.id, "❌ Mail tidak ditemukan.", true);
      return;
    }
    await answerCb(env, cb.id);
    await showMail(env, chatId, mailId, addr.address, messageId);
    return;
  }

  await answerCb(env, cb.id, "❓ Aksi tidak dikenal.", true);
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
