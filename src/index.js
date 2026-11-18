// Shah Apiaries: storefront (./public) + order API + admin API on Cloudflare Workers.
import { HttpError, json, readJson, checkSameOrigin, clientIp, rateLimit, recordHit } from "./http.js";
import { catalogResponse, createOrder, verifyPayment, handleWebhook, trackOrder } from "./orders.js";
import { getAdmin, requireAdmin, login, logoutCookie, revokeSessions, SESSION_SCHEMA } from "./auth.js";
import { summary, listOrders, getOrder, updateOrder, deleteOrder } from "./admin.js";
import { SCHEMA as PROMO_SCHEMA, seedPromoCodes, checkPromo, listPromos, createPromos, updatePromo } from "./promo.js";

// Adds columns introduced after the first launch to an existing database, once per Worker instance.
let schemaReady = null;
function ensureSchema(env) {
  schemaReady ||= (async () => {
    await env.DB.prepare(PROMO_SCHEMA).run();
    await env.DB.prepare(SESSION_SCHEMA).run();
    await seedPromoCodes(env);
    try { await env.DB.prepare("SELECT advance FROM orders LIMIT 1").all(); }
    catch {
      try { await env.DB.prepare("ALTER TABLE orders ADD COLUMN advance INTEGER NOT NULL DEFAULT 0").run(); }
      catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; } // another instance got there first
    }
  })().catch(err => { schemaReady = null; throw err; });
  return schemaReady;
}

async function api(request, env, url) {
  const { pathname } = url;
  if (pathname !== "/api/catalog") await ensureSchema(env);
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && pathname !== "/api/webhooks/razorpay") checkSameOrigin(request, url);

  // ----- Public -----
  if (pathname === "/api/catalog" && method === "GET") {
    return json(catalogResponse(env), 200, { "cache-control": "public, max-age=60" });
  }
  if (pathname === "/api/orders" && method === "POST") {
    return json(await createOrder(env, await readJson(request), request), 201);
  }
  if (pathname === "/api/coupons/check" && method === "POST") {
    return json(await checkPromo(env, request, (await readJson(request)).code));
  }
  if (pathname === "/api/orders/verify" && method === "POST") {
    const ip = clientIp(request);
    await rateLimit(env, "verify", ip, 30, 15 * 60 * 1000, "Too many attempts. Please wait 15 minutes.");
    await recordHit(env, "verify", ip);
    return json(await verifyPayment(env, await readJson(request)));
  }
  let m = pathname.match(/^\/api\/orders\/(SA-[0-9A-Z-]{6,20})$/i);
  if (m && method === "GET") {
    // Slows down anyone walking through order numbers looking for a real one.
    const ip = clientIp(request);
    await rateLimit(env, "track", ip, 30, 15 * 60 * 1000, "Too many lookups. Please wait 15 minutes.");
    await recordHit(env, "track", ip);
    return json({ order: await trackOrder(env, m[1], url.searchParams.get("phone")) });
  }
  if (pathname === "/api/webhooks/razorpay" && method === "POST") {
    return json(await handleWebhook(env, request));
  }

  // ----- Admin -----
  if (pathname === "/api/admin/login" && method === "POST") {
    const { user, cookie } = await login(request, env, await readJson(request));
    return json({ user }, 200, { "set-cookie": cookie });
  }
  if (pathname === "/api/admin/logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": logoutCookie });
  }
  if (pathname === "/api/admin/me" && method === "GET") {
    const user = await getAdmin(request, env);
    return user ? json({ user }) : json({ error: "Not logged in." }, 401);
  }
  if (pathname.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);
    if (pathname === "/api/admin/revoke-sessions" && method === "POST") {
      return json(await revokeSessions(env, admin), 200, { "set-cookie": logoutCookie });
    }
    if (pathname === "/api/admin/summary" && method === "GET") return json(await summary(env));
    if (pathname === "/api/admin/orders" && method === "GET") return json(await listOrders(env, url.searchParams));
    m = pathname.match(/^\/api\/admin\/orders\/(SA-[0-9A-Z-]{6,20})$/i);
    if (m && method === "GET") return json(await getOrder(env, m[1].toUpperCase()));
    if (m && method === "POST") return json(await updateOrder(env, m[1].toUpperCase(), await readJson(request), admin));
    if (m && method === "DELETE") return json(await deleteOrder(env, m[1].toUpperCase()));
    if (pathname === "/api/admin/codes" && method === "GET") return json(await listPromos(env));
    if (pathname === "/api/admin/codes" && method === "POST") return json(await createPromos(env, await readJson(request)));
    m = pathname.match(/^\/api\/admin\/codes\/([A-Z0-9-]{6,30})$/i);
    if (m && method === "POST") return json(await updatePromo(env, m[1].toUpperCase(), await readJson(request)));
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: "Something went wrong on our side. Please try again." }, 500);
      }
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
};

// Sent with every page and asset.
//
// frame-ancestors is the one that matters most: without it any site can load /admin
// in an invisible frame and collect your clicks on the real buttons underneath.
//
// script-src still allows 'unsafe-inline' because the storefront and the admin page
// keep their JavaScript inline in one file. That is a real limit on what this CSP can
// stop, but the directives below still block an injected <script src> to somewhere
// else, plugins, and any attempt to rewrite the page's base URL.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Razorpay's checkout pulls its own styles, fonts and frames at payment time, and a
  // policy that is too tight here breaks paying rather than anything visible in testing.
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://*.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.razorpay.com",
  "font-src 'self' data: https://fonts.gstatic.com https://*.razorpay.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.razorpay.com",
  "frame-src 'self' https://*.razorpay.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'"
].join("; ");

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  res.headers.set("content-security-policy", CSP);
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("permissions-policy", "geolocation=(), microphone=(), camera=(), payment=(self)");
  res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  return res;
}
