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

  if (parsed.cmd === "start") {
    if (!auth.ok && !isBootstrapAllowed(env, chatId)) {
      await sendMessage(
        env,
        chatId,
        `Unauthorized.\nchat_id: ${chatId}\nKirim id ini ke admin untuk di-whitelist.`
      );
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

async function resolveOwnedAddress(env: Env, chatId: string, key?: string) {
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
  await sendMessage(
    env,
    chatId,
    ok ? "Alamat dinonaktifkan." : "Gagal / tidak ketemu."
  );
}

async function cmdDomains(env: Env, chatId: string) {
  const admin = await assertAdmin(env, chatId);
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
