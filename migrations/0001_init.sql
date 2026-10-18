-- Orders placed on the website
CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,          -- e.g. SA-261018-7K3QX
  created_at          INTEGER NOT NULL,          -- unix ms
  updated_at          INTEGER NOT NULL,
  status              TEXT NOT NULL,             -- pending_payment | placed | confirmed | packed | shipped | delivered | cancelled
  payment_method      TEXT NOT NULL,             -- online | link | cod
  payment_status      TEXT NOT NULL,             -- pending | paid | failed | awaiting_link | cod | refunded
  name                TEXT NOT NULL,
  phone               TEXT NOT NULL,             -- 10 digits
  email               TEXT,
  address             TEXT NOT NULL,
  city                TEXT NOT NULL,
  pin                 TEXT NOT NULL,
  gift_note           TEXT,
  coupon              TEXT,
  discount_label      TEXT,
  subtotal            INTEGER NOT NULL,          -- all money in paise
  discount            INTEGER NOT NULL,
  shipping            INTEGER NOT NULL,
  cod_fee             INTEGER NOT NULL,
  total               INTEGER NOT NULL,
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  paid_at             INTEGER,
  courier             TEXT,
  awb                 TEXT,
  tracking_url        TEXT,
  admin_note          TEXT
);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_status  ON orders(status);
CREATE INDEX idx_orders_phone   ON orders(phone);
CREATE UNIQUE INDEX idx_orders_rzp ON orders(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

CREATE TABLE order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  product_id    TEXT NOT NULL,
  variant_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  unit_price    INTEGER NOT NULL,
  subscription  INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL
);
CREATE INDEX idx_items_order ON order_items(order_id);

-- Status history shown to the customer and in the dashboard
CREATE TABLE order_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  TEXT NOT NULL REFERENCES orders(id),
  at        INTEGER NOT NULL,
  status    TEXT,
  note      TEXT,
  actor     TEXT,                 -- customer | razorpay | system | admin username
  public    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_events_order ON order_events(order_id, at);

-- Failed admin logins, for rate limiting
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_login_fail ON login_failures(ip, at);
