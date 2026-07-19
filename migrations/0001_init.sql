CREATE TABLE domains (
  name TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  owner_chat_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_addresses_owner ON addresses(owner_chat_id);
CREATE INDEX idx_addresses_active ON addresses(active);

CREATE TABLE mails (
  id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  received_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (address_id) REFERENCES addresses(id)
);

CREATE INDEX idx_mails_address ON mails(address_id, received_at);

CREATE TABLE users (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
