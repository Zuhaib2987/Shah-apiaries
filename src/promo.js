// Friends & family codes: each code gives PRICING.promoPct off and works once.
// Codes live only in the database (never in GitHub), are created at random,
// and become usable again if the order that used them is cancelled.
import { PRICING } from "./catalog.js";
import { HttpError, clientIp } from "./http.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
const MAX_FAILS = 15, FAIL_WINDOW_MS = 15 * 60 * 1000;

export const isPromoShape = code => new RegExp(`^(${PRICING.promoPrefixes.join("|")})-[${ALPHABET}]{5}$`).test(code);

function randomCode(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}-${[...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("")}`;
}

export const SCHEMA = `CREATE TABLE IF NOT EXISTS promo_codes (
  code          TEXT PRIMARY KEY,
  pct           INTEGER NOT NULL,
  note          TEXT,                 -- who it was given to
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  used_order_id TEXT,
  used_at       INTEGER,
  used_phone    TEXT
)`;

// First run only: create the starting set (e.g. 5 HIVE20 + 5 FAMILY20) in one statement.
export async function seedPromoCodes(env) {
  const rows = [];
  for (const prefix of PRICING.promoPrefixes) for (let i = 0; i < PRICING.promoStartCount; i++) rows.push(randomCode(prefix));
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO promo_codes (code, pct, created_at)
      SELECT column1, column2, column3 FROM (VALUES ${rows.map(() => "(?,?,?)").join(",")})
      WHERE NOT EXISTS (SELECT 1 FROM promo_codes)`)
    .bind(...rows.flatMap(c => [c, PRICING.promoPct, now])).run();
}

async function tooManyFails(env, ip) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind("promo:" + ip, Date.now() - FAIL_WINDOW_MS).first();
  return n >= MAX_FAILS;
}
const recordFail = (env, ip) => env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind("promo:" + ip, Date.now()).run();

// Checks a code without using it up. Returns { code, pct } or throws a friendly error.
export async function checkPromo(env, request, raw) {
  const code = String(raw || "").trim().toUpperCase();
  const ip = clientIp(request);
  if (await tooManyFails(env, ip)) throw new HttpError(429, "Too many wrong codes. Please wait 15 minutes.");
  const row = isPromoShape(code) ? await env.DB.prepare("SELECT * FROM promo_codes WHERE code = ?").bind(code).first() : null;
  if (!row || !row.active) { await recordFail(env, ip); throw new HttpError(400, "That code is not valid."); }
  if (row.used_order_id) throw new HttpError(409, "This code has already been used.");
  return { code, pct: row.pct };
}

// Marks a code as used by an order. Only one order can ever win the same code.
export async function claimPromo(env, code, orderId, phone) {
  const res = await env.DB.prepare(`UPDATE promo_codes SET used_order_id = ?, used_at = ?, used_phone = ?
      WHERE code = ? AND active = 1 AND used_order_id IS NULL`).bind(orderId, Date.now(), phone, code).run();
  if (!res.meta?.changes) throw new HttpError(409, "This code has already been used.");
}
export const releasePromo = (env, orderId) =>
  env.DB.prepare("UPDATE promo_codes SET used_order_id = NULL, used_at = NULL, used_phone = NULL WHERE used_order_id = ?").bind(orderId);

// ----- Admin -----
export async function listPromos(env) {
  const rows = (await env.DB.prepare(`SELECT p.*, o.name AS used_name, o.status AS used_status FROM promo_codes p
      LEFT JOIN orders o ON o.id = p.used_order_id ORDER BY p.created_at, p.code`).all()).results;
  return { codes: rows, prefixes: PRICING.promoPrefixes, pct: PRICING.promoPct };
}
export async function createPromos(env, body) {
  const prefix = String(body.prefix || "").toUpperCase();
  const count = Math.floor(Number(body.count));
  if (!PRICING.promoPrefixes.includes(prefix)) throw new HttpError(400, "Pick a code type.");
  if (!(count >= 1 && count <= 20)) throw new HttpError(400, "Make between 1 and 20 codes at a time.");
  const now = Date.now();
  await env.DB.batch(Array.from({ length: count }, () =>
    env.DB.prepare("INSERT OR IGNORE INTO promo_codes (code, pct, created_at) VALUES (?,?,?)").bind(randomCode(prefix), PRICING.promoPct, now)));
  return listPromos(env);
}
export async function updatePromo(env, code, body) {
  const row = await env.DB.prepare("SELECT code FROM promo_codes WHERE code = ?").bind(code).first();
  if (!row) throw new HttpError(404, "Code not found.");
  const sets = [], binds = [];
  if (body.note !== undefined) { sets.push("note = ?"); binds.push(String(body.note).trim().slice(0, 80) || null); }
  if (body.active !== undefined) { sets.push("active = ?"); binds.push(body.active ? 1 : 0); }
  if (!sets.length) throw new HttpError(400, "Nothing to update.");
  await env.DB.prepare(`UPDATE promo_codes SET ${sets.join(", ")} WHERE code = ?`).bind(...binds, code).run();
  return listPromos(env);
}
