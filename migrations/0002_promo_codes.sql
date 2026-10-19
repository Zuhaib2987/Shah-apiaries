-- Friends & family codes (also created automatically by the Worker on start)
CREATE TABLE IF NOT EXISTS promo_codes (
  code          TEXT PRIMARY KEY,
  pct           INTEGER NOT NULL,
  note          TEXT,                 -- who it was given to
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  used_order_id TEXT,
  used_at       INTEGER,
  used_phone    TEXT
);
