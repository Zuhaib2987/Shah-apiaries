import { b64urlDecode, b64urlEncode, hmacHex, safeEqual, verifyPassword } from "./crypto.js";
import { HttpError, clientIp, countHits } from "./http.js";

const COOKIE = "sa_admin";
const SESSION_DAYS = 7;
const MAX_FAILS = 8;                    // wrong tries per IP...
const MAX_FAILS_PER_USER = 10;          // ...and per account name, so one password
const FAIL_WINDOW_MS = 15 * 60 * 1000;  // cannot be guessed forever from many addresses

// Same shape and cost as a real stored hash, matching no password anyone can type.
// Used only to keep the timing of a wrong username the same as a wrong password.
const DUMMY_HASH = "pbkdf2_sha256$100000$c2hhaGFwaWFyaWVzLWR1bW15LXNhbHQ=$ZHVtbXktaGFzaC10aGF0LW1hdGNoZXMtbm90aGluZw==";

export const SESSION_SCHEMA = `CREATE TABLE IF NOT EXISTS admin_revocations (
  user TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
)`;

function adminUsers(env) {
  try {
    const raw = String(env.ADMIN_USERS || "{}").trim().replace(/[\u201C\u201D]/g, '"'); // undo phone "smart quotes"
    const users = JSON.parse(raw);
    return users && typeof users === "object" ? users : {};
  } catch { console.error("ADMIN_USERS is not valid JSON"); return {}; }
}

function sessionSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, "Admin login is not set up yet (SESSION_SECRET missing).");
  return env.SESSION_SECRET;
}

async function sign(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacHex(sessionSecret(env), body)}`;
}

// Short fingerprint of the stored password hash. It travels inside the session token,
// so changing a password changes the fingerprint and every old session stops working.
// Without this, changing the password after a suspected leak did nothing.
const passwordStamp = async (env, storedHash) => (await hmacHex(sessionSecret(env), "pw:" + storedHash)).slice(0, 16);

// Time of the last "sign out everywhere" for this user, 0 if never.
async function revokedAt(env, user) {
  try {
    const row = await env.DB.prepare("SELECT at FROM admin_revocations WHERE user = ?").bind(user).first();
    return row?.at || 0;
  } catch { return 0; } // table not created yet: fail open rather than lock everyone out
}

export async function getAdmin(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)sa_admin=([^;]+)/);
  if (!match) return null;
  const [body, sig] = match[1].split(".");
  if (!body || !sig) return null;
  if (!safeEqual(await hmacHex(sessionSecret(env), body), sig)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    const stored = adminUsers(env)[data.u];
    if (!stored) return null;                                      // user removed
    if (!safeEqual(data.pw || "", await passwordStamp(env, stored))) return null; // password changed
    if (!data.iat || data.iat < await revokedAt(env, data.u)) return null;        // signed out everywhere
    return data.u;
  } catch { return null; }
}

// Ends every session for this admin, including the one making the request.
export async function revokeSessions(env, user) {
  await env.DB.prepare("INSERT INTO admin_revocations (user, at) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET at = excluded.at")
    .bind(user, Date.now()).run();
  return { ok: true };
}

export async function requireAdmin(request, env) {
  const user = await getAdmin(request, env);
  if (!user) throw new HttpError(401, "Please log in again.");
  return user;
}

export async function login(request, env, { username, password }) {
  sessionSecret(env); // fails clearly if SESSION_SECRET is missing
  if (!Object.keys(adminUsers(env)).length)
    throw new HttpError(503, "Admin login isn't set up yet: the ADMIN_USERS secret is missing or not pasted correctly.");
  const ip = clientIp(request);
  const user = String(username || "").trim().toLowerCase();
  const tooMany = "Too many wrong attempts. Wait 15 minutes and try again.";
  if (await countHits(env, "login", ip, FAIL_WINDOW_MS) >= MAX_FAILS) throw new HttpError(429, tooMany);
  // Also counted per account, so spreading the guessing over many IP addresses does not help.
  if (user && await countHits(env, "login-user", user, FAIL_WINDOW_MS) >= MAX_FAILS_PER_USER) throw new HttpError(429, tooMany);

  // An unknown username used to skip the hash check and answer in a fraction of the
  // time, which told an attacker which account names are real. Unknown names now go
  // through the same work against a throwaway hash, so both answer alike.
  const stored = adminUsers(env)[user];
  const ok = await verifyPassword(password, stored || DUMMY_HASH) && Boolean(stored);
  if (!ok) {
    // The attempted username is never logged: it ends up in Cloudflare's log, and a
    // mistyped password often lands in that field.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(`login:${ip}`, Date.now()),
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(`login-user:${user}`, Date.now()),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(Date.now() - 24 * 3600 * 1000)
    ]);
    throw new HttpError(401, "Wrong username or password.");
  }
  const now = Date.now();
  const token = await sign(env, { u: user, iat: now, pw: await passwordStamp(env, stored), exp: now + SESSION_DAYS * 86400000 });
  return { user, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}` };
}

export const logoutCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
