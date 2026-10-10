import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  owner_id INTEGER NOT NULL, created_at REAL NOT NULL,
  default_model INTEGER NOT NULL DEFAULT 0, model_set INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS demo_nodes(node_id TEXT PRIMARY KEY, device_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(group_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  role TEXT NOT NULL, PRIMARY KEY(group_id, user_id));
CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, group_id INTEGER NOT NULL,
  expires_at REAL NOT NULL, used_by INTEGER);
CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL, name TEXT NOT NULL, key_enc BLOB NOT NULL,
  created_at REAL NOT NULL, last_seen REAL);
CREATE TABLE IF NOT EXISTS setup_tokens(token TEXT PRIMARY KEY, device_id INTEGER NOT NULL,
  expires_at REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY, device_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL, ciphertext BLOB NOT NULL, status TEXT NOT NULL,
  claimed_by INTEGER, claim_expires_at REAL, answer_blob BLOB, answer_meta TEXT,
  created_at REAL NOT NULL, answered_at REAL, receipt_at REAL);
CREATE TABLE IF NOT EXISTS usage(group_id INTEGER NOT NULL, day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id, day));
"""


MIGRATIONS = [
    ("groups", "default_model", "ALTER TABLE groups ADD COLUMN default_model INTEGER NOT NULL DEFAULT 0"),
    ("groups", "model_set", "ALTER TABLE groups ADD COLUMN model_set INTEGER NOT NULL DEFAULT 0"),
]


def init(path):
    with connect(path) as c:
        c.executescript(SCHEMA)
        for table, column, sql in MIGRATIONS:  # databases created before these columns existed
            if column not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}:
                c.execute(sql)


@contextmanager
def connect(path):
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()
