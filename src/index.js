// Shah Apiaries: storefront (./public) + order API + admin API on Cloudflare Workers.
import { HttpError, json, readJson, checkSameOrigin } from "./http.js";
import { catalogResponse, createOrder, verifyPayment, handleWebhook, trackOrder } from "./orders.js";
import { getAdmin, requireAdmin, login, logoutCookie } from "./auth.js";
import { summary, listOrders, getOrder, updateOrder, deleteOrder } from "./admin.js";

async function api(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && pathname !== "/api/webhooks/razorpay") checkSameOrigin(request, url);

  // ----- Public -----
  if (pathname === "/api/catalog" && method === "GET") {
    return json(catalogResponse(env), 200, { "cache-control": "public, max-age=60" });
  }
  if (pathname === "/api/orders" && method === "POST") {
    return json(await createOrder(env, await readJson(request)), 201);
  }
  if (pathname === "/api/orders/verify" && method === "POST") {
    return json(await verifyPayment(env, await readJson(request)));
  }
  let m = pathname.match(/^\/api\/orders\/(SA-[0-9A-Z-]{6,20})$/i);
  if (m && method === "GET") {
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
    if (pathname === "/api/admin/summary" && method === "GET") return json(await summary(env));
    if (pathname === "/api/admin/orders" && method === "GET") return json(await listOrders(env, url.searchParams));
    m = pathname.match(/^\/api\/admin\/orders\/(SA-[0-9A-Z-]{6,20})$/i);
    if (m && method === "GET") return json(await getOrder(env, m[1].toUpperCase()));
    if (m && method === "POST") return json(await updateOrder(env, m[1].toUpperCase(), await readJson(request), admin));
    if (m && method === "DELETE") return json(await deleteOrder(env, m[1].toUpperCase()));
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
    return env.ASSETS.fetch(request);
  }
};
