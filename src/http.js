export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers
    }
  });
}

export async function readJson(request, maxBytes = 20000) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Send the request as JSON.");
  const text = await readText(request, maxBytes);
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Invalid request."); }
}

// Reads a request body with a size cap, so a huge upload cannot be buffered.
export async function readText(request, maxBytes = 20000) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw new HttpError(413, "Request too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  return text;
}

// Blocks form posts from other websites (cross-site request forgery).
export function checkSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "Request from another site was blocked.");
}

// Only cf-connecting-ip is trusted. Cloudflare sets it on every request and strips
// any copy the caller sent. x-forwarded-for is written by the caller, so trusting it
// would let an attacker invent a fresh address per request and walk past every limit.
export const clientIp = request => request.headers.get("cf-connecting-ip") || "unknown";

// Simple sliding-window counter shared by logins, promo codes and order creation.
// Hits live in login_failures, which already has the (ip, at) index this needs;
// each caller passes its own bucket so the counts never mix.
export async function countHits(env, bucket, key, windowMs) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(`${bucket}:${key}`, Date.now() - windowMs).first();
  return n;
}
export const recordHit = (env, bucket, key) =>
  env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(`${bucket}:${key}`, Date.now()).run();

export async function rateLimit(env, bucket, key, max, windowMs, message) {
  if (await countHits(env, bucket, key, windowMs) >= max) throw new HttpError(429, message);
}
