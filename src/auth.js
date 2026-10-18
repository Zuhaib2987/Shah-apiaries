import { b64urlDecode, b64urlEncode, hmacHex, safeEqual, verifyPassword } from "./crypto.js";
import { HttpError, clientIp } from "./http.js";

const COOKIE = "sa_admin";
const SESSION_DAYS = 30;
const MAX_FAILS = 8;            // per IP...
const FAIL_WINDOW_MS = 15 * 60 * 1000; // ...per 15 minutes

function adminUsers(env) {
  try { return JSON.parse(env.ADMIN_USERS || "{}"); } catch { console.error("ADMIN_USERS is not valid JSON"); return {}; }
}

function sessionSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, "Admin login is not set up yet (SESSION_SECRET missing).");
  return env.SESSION_SECRET;
}

async function sign(env, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacHex(sessionSecret(env), body)}`;
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
    if (!adminUsers(env)[data.u]) return null; // user removed
    return data.u;
  } catch { return null; }
}

export async function requireAdmin(request, env) {
  const user = await getAdmin(request, env);
  if (!user) throw new HttpError(401, "Please log in again.");
  return user;
}

export async function login(request, env, { username, password }) {
  const ip = clientIp(request);
  const since = Date.now() - FAIL_WINDOW_MS;
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?").bind(ip, since).first();
  if (n >= MAX_FAILS) throw new HttpError(429, "Too many wrong attempts. Wait 15 minutes and try again.");

  const user = String(username || "").trim().toLowerCase();
  const stored = adminUsers(env)[user];
  const ok = stored ? await verifyPassword(password, stored) : false;
  if (!ok) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, Date.now()),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(Date.now() - 24 * 3600 * 1000)
    ]);
    throw new HttpError(401, "Wrong username or password.");
  }
  const token = await sign(env, { u: user, exp: Date.now() + SESSION_DAYS * 86400000 });
  return { user, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}` };
}

export const logoutCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
