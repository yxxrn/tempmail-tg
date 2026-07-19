export type DomainRow = { name: string; active: number; created_at: string };
export type AddressRow = {
  id: string;
  address: string;
  local_part: string;
  domain: string;
  owner_chat_id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  active: number;
};
export type MailRow = {
  id: string;
  address_id: string;
  from_addr: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  received_at: string;
  read: number;
};
export type UserRow = {
  chat_id: string;
  username: string | null;
  role: string;
  active: number;
  created_at: string;
};

export async function listActiveDomains(db: D1Database): Promise<DomainRow[]> {
  const r = await db
    .prepare("SELECT * FROM domains WHERE active = 1 ORDER BY name")
    .all<DomainRow>();
  return r.results ?? [];
}

export async function getDomain(
  db: D1Database,
  name: string
): Promise<DomainRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM domains WHERE name = ?")
      .bind(name)
      .first<DomainRow>()) ?? null
  );
}

export async function addDomain(db: D1Database, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO domains (name, active, created_at) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET active = 1"
    )
    .bind(name.toLowerCase(), now)
    .run();
}

export async function setDomainActive(
  db: D1Database,
  name: string,
  active: boolean
): Promise<void> {
  await db
    .prepare("UPDATE domains SET active = ? WHERE name = ?")
    .bind(active ? 1 : 0, name.toLowerCase())
    .run();
}

export async function createAddress(
  db: D1Database,
  row: AddressRow
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO addresses
      (id, address, local_part, domain, owner_chat_id, token, created_at, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.address,
      row.local_part,
      row.domain,
      row.owner_chat_id,
      row.token,
      row.created_at,
      row.expires_at,
      row.active
    )
    .run();
}

export async function getAddressByAddress(
  db: D1Database,
  address: string
): Promise<AddressRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM addresses WHERE address = ?")
      .bind(address.toLowerCase())
      .first<AddressRow>()) ?? null
  );
}

export async function getAddressById(
  db: D1Database,
  id: string
): Promise<AddressRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM addresses WHERE id = ?")
      .bind(id)
      .first<AddressRow>()) ?? null
  );
}

export async function listAddressesByOwner(
  db: D1Database,
  chatId: string
): Promise<AddressRow[]> {
  const r = await db
    .prepare(
      "SELECT * FROM addresses WHERE owner_chat_id = ? AND active = 1 ORDER BY created_at DESC"
    )
    .bind(chatId)
    .all<AddressRow>();
  return r.results ?? [];
}

export async function countActiveAddresses(
  db: D1Database,
  chatId: string
): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM addresses WHERE owner_chat_id = ? AND active = 1"
    )
    .bind(chatId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function deactivateAddress(
  db: D1Database,
  idOrAddress: string,
  chatId: string
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE addresses SET active = 0
       WHERE owner_chat_id = ? AND active = 1
         AND (id = ? OR address = ?)`
    )
    .bind(chatId, idOrAddress, idOrAddress.toLowerCase())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function insertMail(db: D1Database, row: MailRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mails
      (id, address_id, from_addr, subject, body_text, body_html, received_at, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.address_id,
      row.from_addr,
      row.subject,
      row.body_text,
      row.body_html,
      row.received_at,
      row.read
    )
    .run();
}

export async function listMails(
  db: D1Database,
  addressId: string,
  limit = 10
): Promise<MailRow[]> {
  const r = await db
    .prepare(
      "SELECT * FROM mails WHERE address_id = ? ORDER BY received_at DESC LIMIT ?"
    )
    .bind(addressId, limit)
    .all<MailRow>();
  return r.results ?? [];
}

export async function getMail(
  db: D1Database,
  id: string
): Promise<MailRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM mails WHERE id = ?")
      .bind(id)
      .first<MailRow>()) ?? null
  );
}

export async function markMailRead(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE mails SET read = 1 WHERE id = ?").bind(id).run();
}

export async function trimMails(
  db: D1Database,
  addressId: string,
  keep: number
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM mails WHERE address_id = ? AND id NOT IN (
         SELECT id FROM mails WHERE address_id = ?
         ORDER BY received_at DESC LIMIT ?
       )`
    )
    .bind(addressId, addressId, keep)
    .run();
}

export async function getUser(
  db: D1Database,
  chatId: string
): Promise<UserRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM users WHERE chat_id = ?")
      .bind(chatId)
      .first<UserRow>()) ?? null
  );
}

export async function upsertUser(
  db: D1Database,
  chatId: string,
  username: string | null,
  role = "user"
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (chat_id, username, role, active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(chat_id) DO UPDATE SET username = excluded.username, active = 1`
    )
    .bind(chatId, username, role, now)
    .run();
}

export async function setUserActive(
  db: D1Database,
  chatId: string,
  active: boolean
): Promise<void> {
  await db
    .prepare("UPDATE users SET active = ? WHERE chat_id = ?")
    .bind(active ? 1 : 0, chatId)
    .run();
}

export async function countNewAddressSince(
  db: D1Database,
  chatId: string,
  isoSince: string
): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM addresses WHERE owner_chat_id = ? AND created_at >= ?"
    )
    .bind(chatId, isoSince)
    .first<{ c: number }>();
  return r?.c ?? 0;
}
