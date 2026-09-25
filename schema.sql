CREATE TABLE IF NOT EXISTS latest_status (
  host_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  metrics TEXT NOT NULL
);
