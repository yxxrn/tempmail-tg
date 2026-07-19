-- Replace REPLACE_CHAT_ID and example.com before applying
INSERT INTO users (chat_id, username, role, active, created_at)
VALUES ('REPLACE_CHAT_ID', 'admin', 'admin', 1, datetime('now'))
ON CONFLICT(chat_id) DO UPDATE SET role = 'admin', active = 1;

INSERT INTO domains (name, active, created_at)
VALUES ('example.com', 1, datetime('now'))
ON CONFLICT(name) DO UPDATE SET active = 1;
