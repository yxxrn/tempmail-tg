import type { Env } from "./env";
import { checkApiKey, checkWebhookSecret } from "./auth";
import {
  countActiveAddresses,
  countNewAddressSince,
  createAddress,
  getAddressByAddress,
  getAddressById,
  getMail,
  listActiveDomains,
  listMails,
} from "./db";
import { randomId, randomLocalPart, randomToken } from "./ids";
import {
  hourAgoIso,
  MAX_ADDRESSES,
  MAX_NEW_PER_HOUR,
} from "./limits";
import { handleTelegramUpdate } from "./bot";

export async function handleApi(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health") {
    return new Response("ok");
  }

  if (path === "/api/telegram" && request.method === "POST") {
    if (!checkWebhookSecret(env, request)) {
      return new Response("forbidden", { status: 403 });
    }
    const update = (await request.json()) as Parameters<
      typeof handleTelegramUpdate
    >[1];
    await handleTelegramUpdate(env, update);
    return new Response("ok");
  }

  if (path === "/api/new" && request.method === "POST") {
    if (!checkApiKey(env, request)) {
      return new Response("unauthorized", { status: 401 });
    }
    let body: { domain?: string; owner_chat_id?: string } = {};
    try {
      body = (await request.json()) as {
        domain?: string;
        owner_chat_id?: string;
      };
    } catch {
      /* empty */
    }
    const owner =
      body.owner_chat_id || env.ALLOWED_CHAT_IDS.split(",")[0]?.trim();
    if (!owner) {
      return Response.json(
        { error: "owner_chat_id required" },
        { status: 400 }
      );
    }
    if ((await countActiveAddresses(env.DB, owner)) >= MAX_ADDRESSES) {
      return Response.json({ error: "address limit" }, { status: 429 });
    }
    if (
      (await countNewAddressSince(env.DB, owner, hourAgoIso())) >=
      MAX_NEW_PER_HOUR
    ) {
      return Response.json({ error: "rate limit" }, { status: 429 });
    }
    let domain = body.domain?.toLowerCase();
    const domains = await listActiveDomains(env.DB);
    if (!domains.length) {
      return Response.json({ error: "no active domain" }, { status: 400 });
    }
    if (domain && !domains.find((d) => d.name === domain)) {
      return Response.json({ error: "domain inactive" }, { status: 400 });
    }
    if (!domain) {
      domain = domains[Math.floor(Math.random() * domains.length)].name;
    }
    const local = randomLocalPart();
    const address = `${local}@${domain}`;
    const id = randomId();
    const token = randomToken();
    await createAddress(env.DB, {
      id,
      address,
      local_part: local,
      domain,
      owner_chat_id: owner,
      token,
      created_at: new Date().toISOString(),
      expires_at: null,
      active: 1,
    });
    return Response.json({ id, address, token });
  }

  if (path === "/api/inbox" && request.method === "GET") {
    const address = url.searchParams.get("address") || "";
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const row = await getAddressByAddress(env.DB, address);
    if (!row || row.token !== token || row.active !== 1) {
      return new Response("unauthorized", { status: 401 });
    }
    const mails = await listMails(env.DB, row.id, 20);
    return Response.json(
      mails.map((m) => ({
        id: m.id,
        from: m.from_addr,
        subject: m.subject,
        received_at: m.received_at,
        preview: m.body_text.slice(0, 200),
      }))
    );
  }

  if (path.startsWith("/api/mail/") && request.method === "GET") {
    const id = path.slice("/api/mail/".length);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const mail = await getMail(env.DB, id);
    if (!mail) return new Response("not found", { status: 404 });
    const addr = await getAddressById(env.DB, mail.address_id);
    if (!addr || addr.token !== token) {
      return new Response("unauthorized", { status: 401 });
    }
    return Response.json(mail);
  }

  return null;
}
