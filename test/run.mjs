// API tests. Run with: npm test
import assert from "node:assert/strict";
import { start } from "./harness.mjs";
import { PRICING, PRODUCTS, findVariant } from "../src/catalog.js";

// Expected amounts are worked out from the catalogue rather than typed in, so changing
// a price does not break a dozen tests. The rules being checked (the advance split, the
// buy-3 saving, the coupons, free shipping) are still asserted as arithmetic here, and
// a wrong rule in src/pricing.js still fails, because this is a second implementation.
const paise = rupees => Math.round(rupees * 100);
const priceOf = (pid, vid) => paise(findVariant(pid, vid).variant.price);
function quote(items, { payment = "online", pin = "190008", discountPct = 0 } = {}) {
  const subtotal = items.reduce((a, [pid, vid, qty = 1]) => a + priceOf(pid, vid) * qty, 0);
  const count = items.reduce((a, [, , qty = 1]) => a + (qty || 1), 0);
  const bulk = count >= PRICING.bulkMinItems ? Math.round(subtotal * PRICING.bulkPct / 100) : 0;
  const discount = Math.max(bulk, discountPct ? Math.round(subtotal * discountPct / 100) : 0);
  const after = subtotal - discount;
  const shipping = after >= paise(PRICING.freeShippingAbove) ? 0 : paise(PRICING.shippingFee);
  const codFee = payment === "cod" ? paise(PRICING.codFee) : 0;
  const total = after + shipping + codFee;
  const jk = Number(String(pin).slice(0, 3)) >= 180 && Number(String(pin).slice(0, 3)) <= 193;
  const pct = payment === "cod" ? (jk ? PRICING.codAdvancePctJK : PRICING.codAdvancePct) : 0;
  const advance = pct ? Math.min(total, Math.ceil(total * pct / 10000) * 100) : 0;
  return { subtotal, discount, shipping, codFee, total, advance };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["ok", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}

const t = await start();
const H = { "content-type": "application/json", origin: t.url };
const post = (path, body, headers = {}) => fetch(t.url + path, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const customer = (phone = "9876543210") => ({ name: "Test Buyer", phone, email: "", address: "House 12, Main Road, Rajbagh", city: "Srinagar", pin: "190008" });

let codId, onlineOrder, adminCookie, promoCodes = [];

await test("catalog lists products and online payments", async () => {
  const r = await fetch(t.url + "/api/catalog"); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.products.length, PRODUCTS.length); assert.equal(j.payments.online, true); assert.equal(j.payments.keyId, "rzp_test_mock");
});

const payAdvance = async j => {
  const pid = "pay_ADV" + j.order.id.slice(-5);
  const r = await post("/api/orders/verify", { orderId: j.order.id, razorpay_order_id: j.razorpay.orderId, razorpay_payment_id: pid, razorpay_signature: t.sign(j.razorpay.orderId, pid) });
  return r.json();
};

await test("J&K COD order asks for a 20% advance online", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  const jk = quote([["acacia", "500"]], { payment: "cod", pin: "190008" });
  assert.equal(j.order.total, jk.total);
  assert.equal(j.order.advance, jk.advance); assert.equal(j.order.balance, jk.total - jk.advance);
  assert.equal(jk.advance, Math.ceil(jk.total * 0.20 / 100) * 100, "J&K advance is 20%, rounded up to whole rupees");
  assert.equal(j.order.status, "pending_payment"); assert.equal(j.order.paymentStatus, "advance_pending");
  assert.equal(j.razorpay.amount, jk.advance);
  codId = j.order.id; assert.match(codId, /^SA-\d{6}-[A-Z0-9]{5}$/);
  const paid = await payAdvance(j);
  assert.equal(paid.order.paymentStatus, "advance_paid"); assert.equal(paid.order.status, "placed");
  const rs = n => "₹" + (n / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  assert.equal(paid.order.events.at(-1).note, `Advance of ${rs(jk.advance)} received. ${rs(jk.total - jk.advance)} to pay on delivery`);
});

await test("COD outside J&K asks for a 50% advance (Ladakh counts as outside)", async () => {
  for (const pin of ["110001", "194101"]) {
    const j = await (await post("/api/orders", { customer: { ...customer("9811111111"), pin }, items: [{ pid: "sulai", vid: "500", qty: 1 }], payment: "cod" })).json();
    const q = quote([["sulai", "500"]], { payment: "cod", pin });
    assert.equal(j.order.total, q.total);
    assert.equal(j.order.advance, q.advance); assert.equal(j.razorpay.amount, q.advance);
    assert.equal(q.advance, Math.ceil(q.total * 0.50 / 100) * 100, "outside J&K the advance is 50%, rounded up");
  }
});

await test("COD order cannot be confirmed before the advance is paid", async () => {
  const j = await (await post("/api/orders", { customer: customer("9822222222"), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" })).json();
  const login = await post("/api/admin/login", { username: "zuhaib", password: "honey-admin-1" });
  const ck = login.headers.get("set-cookie").split(";")[0];
  const r = await post(`/api/admin/orders/${j.order.id}`, { status: "confirmed" }, { cookie: ck });
  assert.equal(r.status, 409); assert.match((await r.json()).error, /advance/);
});

await test("browser cannot change prices", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1, price: 1 }], payment: "cod" });
  assert.equal((await r.json()).order.subtotal, priceOf("acacia", "500"), "the price sent by the browser must be ignored");
});

await test("invalid phone is rejected", async () => {
  const r = await post("/api/orders", { customer: customer("12345"), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /mobile/);
});

await test("sold-out size is rejected", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "sulai", vid: "1kg", qty: 1 }], payment: "cod" });
  assert.equal(r.status, 409);
});

await test("online order creates Razorpay order, buy-3 saving applied", async () => {
  const r = await post("/api/orders", { customer: customer("9123456780"), items: [{ pid: "acacia", vid: "500", qty: 1 }, { pid: "sulai", vid: "500", qty: 1 }, { pid: "multiflora", vid: "1kg", qty: 1 }], payment: "online" });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  const sub = priceOf("acacia", "500") + priceOf("sulai", "500") + priceOf("multiflora", "1kg");
  const disc = Math.round(sub * PRICING.bulkPct / 100);
  assert.equal(j.order.subtotal, sub); assert.equal(j.order.discount, disc); assert.equal(j.order.shipping, 0);
  assert.equal(j.order.status, "pending_payment"); assert.equal(j.razorpay.amount, sub - disc);
  assert.equal(t.rzpOrders.at(-1).receipt, j.order.id);
  onlineOrder = j;
});

await test("forged payment signature is rejected", async () => {
  const r = await post("/api/orders/verify", { orderId: onlineOrder.order.id, razorpay_order_id: onlineOrder.razorpay.orderId, razorpay_payment_id: "pay_fake", razorpay_signature: "deadbeef" });
  assert.equal(r.status, 400);
});

await test("genuine payment signature marks order paid", async () => {
  const pid = "pay_TEST123";
  const r = await post("/api/orders/verify", { orderId: onlineOrder.order.id, razorpay_order_id: onlineOrder.razorpay.orderId, razorpay_payment_id: pid, razorpay_signature: t.sign(onlineOrder.razorpay.orderId, pid) });
  const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.order.paymentStatus, "paid"); assert.equal(j.order.status, "placed");
});

await test("webhook payment.captured marks order paid", async () => {
  const o = await (await post("/api/orders", { customer: customer("9000000001"), items: [{ pid: "trio", vid: "box", qty: 1 }], payment: "online" })).json();
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_WH1", order_id: o.razorpay.orderId } } } });
  const bad = await fetch(t.url + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": "nope" }, body });
  assert.equal(bad.status, 400);
  const r = await fetch(t.url + "/api/webhooks/razorpay", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": t.signWebhook(body) }, body });
  assert.equal(r.status, 200);
  const tr = await (await fetch(`${t.url}/api/orders/${o.order.id}?phone=9000000001`)).json();
  assert.equal(tr.order.paymentStatus, "paid");
});

await test("first-order coupon works once per mobile number", async () => {
  const first = await (await post("/api/orders", { customer: customer("9555555555"), items: [{ pid: "acacia", vid: "500", qty: 1 }], coupon: "welcome10", payment: "cod" })).json();
  assert.equal(first.order.discount, Math.round(priceOf("acacia", "500") * PRICING.couponPct / 100));
  await payAdvance(first); // an order only uses up the coupon once it is paid
  const second = await (await post("/api/orders", { customer: customer("9555555555"), items: [{ pid: "acacia", vid: "500", qty: 1 }], coupon: "WELCOME10", payment: "cod" })).json();
  assert.equal(second.order.discount, 0); assert.equal(second.couponRejected, true);
});

await test("tracking needs the right mobile number", async () => {
  assert.equal((await fetch(`${t.url}/api/orders/${codId}?phone=9999999999`)).status, 404);
  const j = await (await fetch(`${t.url}/api/orders/${codId}?phone=9876543210`)).json();
  assert.equal(j.order.id, codId); assert.equal(j.order.events.length, 2);
});

await test("requests from other websites are blocked", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

await test("admin endpoints need login", async () => {
  assert.equal((await fetch(t.url + "/api/admin/orders")).status, 401);
  assert.equal((await post("/api/admin/login", { username: "zuhaib", password: "wrong" })).status, 401);
});

await test("admin can log in, list and update orders", async () => {
  const r = await post("/api/admin/login", { username: "Zuhaib", password: "honey-admin-1" });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie"); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  adminCookie = sc.split(";")[0];
  const list = await (await fetch(t.url + "/api/admin/orders", { headers: { cookie: adminCookie } })).json();
  assert.ok(list.orders.length >= 5);
  const sum = await (await fetch(t.url + "/api/admin/summary", { headers: { cookie: adminCookie } })).json();
  assert.ok(sum.counts.placed >= 3);
  const up = await post(`/api/admin/orders/${codId}`, { status: "shipped", courier: "India Post", awb: "EK123456789IN", tracking_url: "https://www.indiapost.gov.in" }, { cookie: adminCookie });
  const uj = await up.json(); assert.equal(up.status, 200, JSON.stringify(uj));
  assert.equal(uj.order.status, "shipped");
  const tr = await (await fetch(`${t.url}/api/orders/${codId}?phone=9876543210`)).json();
  assert.equal(tr.order.status, "shipped"); assert.equal(tr.order.awb, "EK123456789IN"); assert.equal(tr.order.events.at(-1).label, "Shipped");
});

await test("second admin user works too", async () => {
  assert.equal((await post("/api/admin/login", { username: "family", password: "honey-admin-2" })).status, 200);
});

await test("unpaid online order cannot be packed until marked paid", async () => {
  const o = await (await post("/api/orders", { customer: customer("9444444444"), items: [{ pid: "comb", vid: "250", qty: 1 }], payment: "online" })).json();
  assert.equal((await post(`/api/admin/orders/${o.order.id}`, { status: "packed" }, { cookie: adminCookie })).status, 409);
  const paid = await (await post(`/api/admin/orders/${o.order.id}`, { markPaid: true }, { cookie: adminCookie })).json();
  assert.equal(paid.order.payment_status, "paid"); assert.equal(paid.order.status, "placed");
});

await test("only cancelled orders can be deleted", async () => {
  const o = await (await post("/api/orders", { customer: customer("9555555555"), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" })).json();
  const del = () => fetch(`${t.url}/api/admin/orders/${o.order.id}`, { method: "DELETE", headers: { cookie: adminCookie } });
  assert.equal((await del()).status, 409);
  await post(`/api/admin/orders/${o.order.id}`, { status: "cancelled" }, { cookie: adminCookie });
  assert.equal((await del()).status, 200);
  assert.equal((await fetch(`${t.url}/api/admin/orders/${o.order.id}`, { headers: { cookie: adminCookie } })).status, 404);
  assert.equal((await fetch(`${t.url}/api/admin/orders/${o.order.id}`, { method: "DELETE" })).status, 401);
});

await test("logged-out cookie is rejected", async () => {
  const r = await post("/api/admin/logout", {}, { cookie: adminCookie });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  const forged = adminCookie.replace(/.$/, c => (c === "a" ? "b" : "a"));
  assert.equal((await fetch(t.url + "/api/admin/orders", { headers: { cookie: forged } })).status, 401);
});

await test("10 friends & family codes exist: 5 HIVE20 and 5 FAMILY20", async () => {
  const j = await (await fetch(t.url + "/api/admin/codes", { headers: { cookie: adminCookie } })).json();
  assert.equal(j.codes.length, 10);
  assert.equal(j.codes.filter(c => /^HIVE20-[A-Z2-9]{5}$/.test(c.code)).length, 5);
  assert.equal(j.codes.filter(c => /^FAMILY20-[A-Z2-9]{5}$/.test(c.code)).length, 5);
  promoCodes = j.codes.map(c => c.code);
});

await test("a friends & family code gives 20% once, and works again if that order is cancelled", async () => {
  const code = promoCodes[0];
  const chk = await post("/api/coupons/check", { code: code.toLowerCase() }); assert.equal(chk.status, 200); assert.equal((await chk.json()).pct, 20);
  const order = () => post("/api/orders", { customer: customer("9833333333"), items: [{ pid: "acacia", vid: "1kg", qty: 1 }], coupon: code, payment: "online" });
  const r1 = await order(); const j1 = await r1.json(); assert.equal(r1.status, 201, JSON.stringify(j1));
  assert.equal(j1.order.discount, Math.round(priceOf("acacia", "1kg") * PRICING.promoPct / 100)); assert.match(j1.order.discountLabel, /Friends & family/);
  const r2 = await order(); assert.equal(r2.status, 409);
  assert.equal((await post("/api/coupons/check", { code })).status, 409);
  const list = await (await fetch(t.url + "/api/admin/codes", { headers: { cookie: adminCookie } })).json();
  assert.equal(list.codes.find(c => c.code === code).used_order_id, j1.order.id);
  await post(`/api/admin/orders/${j1.order.id}`, { status: "cancelled" }, { cookie: adminCookie });
  const r3 = await order(); assert.equal(r3.status, 201);
});

await test("friends & family code beats the buy-3 saving and does not block WELCOME10 later", async () => {
  const r = await post("/api/orders", { customer: customer("9844444444"), items: [{ pid: "acacia", vid: "500", qty: 3 }], coupon: promoCodes[1], payment: "online" });
  const j = await r.json(); assert.equal(j.order.discount, Math.round(priceOf("acacia", "500") * 3 * PRICING.promoPct / 100));
  await post("/api/orders/verify", { orderId: j.order.id, razorpay_order_id: j.razorpay.orderId, razorpay_payment_id: "pay_PR1", razorpay_signature: t.sign(j.razorpay.orderId, "pay_PR1") });
  const w = await (await post("/api/orders", { customer: customer("9844444444"), items: [{ pid: "acacia", vid: "500", qty: 1 }], coupon: "WELCOME10", payment: "online" })).json();
  assert.equal(w.order.discount, Math.round(priceOf("acacia", "500") * PRICING.couponPct / 100));
});

await test("admin can label, disable and create codes", async () => {
  const code = promoCodes[2];
  let j = await (await post(`/api/admin/codes/${code}`, { note: "Uncle Bashir", active: false }, { cookie: adminCookie })).json();
  const c = j.codes.find(x => x.code === code); assert.equal(c.note, "Uncle Bashir"); assert.equal(c.active, 0);
  assert.equal((await post("/api/coupons/check", { code })).status, 400);
  j = await (await post("/api/admin/codes", { prefix: "family20", count: 2 }, { cookie: adminCookie })).json();
  assert.equal(j.codes.length, 12);
  assert.equal((await post("/api/admin/codes", { prefix: "HACK", count: 2 }, { cookie: adminCookie })).status, 400);
  assert.equal((await post("/api/admin/codes", { prefix: "HIVE20", count: 2 })).status, 401);
});

await test("guessing codes is blocked after 15 wrong tries", async () => {
  let last;
  for (let i = 0; i < 16; i++) last = await post("/api/coupons/check", { code: "HIVE20-ZZZZ" + "ABCDEFGHJKLMNPQRS"[i] });
  assert.equal(last.status, 429);
});

await test("too many wrong logins are blocked", async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await post("/api/admin/login", { username: "zuhaib", password: "bad" + i });
  assert.equal(last.status, 429);
});

await test("storefront and admin pages are served", async () => {
  const shop = await fetch(t.url + "/"); assert.equal(shop.status, 200); assert.match(await shop.text(), /Shah Apiaries/);
  const admin = await fetch(t.url + "/admin"); assert.equal(admin.status, 200); assert.match(await admin.text(), /Orders/);
  for (const [path, text] of [["/privacy", /Grievance Officer/], ["/terms", /Cash on delivery/], ["/refund-policy", /48 hours/], ["/shipping-policy", /Free shipping/], ["/contact", /fssai Reg. No. 21026414000454/], ["/about", /Recognition &amp; awards/]]) {
    const r = await fetch(t.url + path); assert.equal(r.status, 200, path); assert.match(await r.text(), text);
  }
});
t.close();

const t2 = await start({ payments: false });
await test("without Razorpay keys, online order becomes a payment-link order", async () => {
  const r = await fetch(t2.url + "/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: customer(), items: [{ pid: "acacia", vid: "1kg", qty: 1 }], payment: "online" }) });
  const j = await r.json(); assert.equal(r.status, 201);
  assert.equal(j.order.paymentMethod, "link"); assert.equal(j.order.status, "placed"); assert.equal(j.razorpay, null);
});
await test("without Razorpay keys, admin marks the COD advance, then the balance", async () => {
  const j = await (await fetch(t2.url + "/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" }) })).json();
  assert.equal(j.razorpay, null); assert.equal(j.order.paymentStatus, "advance_pending"); assert.equal(j.order.advance, quote([["acacia", "500"]], { payment: "cod" }).advance);
  const ck = (await fetch(t2.url + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "zuhaib", password: "honey-admin-1" }) })).headers.get("set-cookie").split(";")[0];
  const mark = async () => (await fetch(`${t2.url}/api/admin/orders/${j.order.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ markPaid: true }) })).json();
  const a = await mark(); assert.equal(a.order.payment_status, "advance_paid"); assert.equal(a.order.status, "placed");
  const b = await mark(); assert.equal(b.order.payment_status, "paid");
});
t2.close();

// ----- Security hardening -----

const t3 = await start({ payments: false, env: { ORDER_RATE_LIMIT_PER_HOUR: "3" } });
const post3 = (path, body, headers = {}) =>
  fetch(t3.url + path, { method: "POST", headers: { "content-type": "application/json", origin: t3.url, ...headers }, body: JSON.stringify(body) });

await test("pages are served with anti-framing and content-security headers", async () => {
  for (const path of ["/", "/admin"]) {
    const r = await fetch(t3.url + path);
    assert.equal(r.headers.get("x-frame-options"), "DENY", path);
    assert.match(r.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, path);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", path);
    assert.match(r.headers.get("referrer-policy") || "", /strict-origin/, path);
  }
});

await test("order flooding is blocked once the hourly limit is reached", async () => {
  const one = () => post3("/api/orders", { customer: customer("9700000001"), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" }, { "cf-connecting-ip": "192.0.2.50" });
  for (let i = 0; i < 3; i++) assert.equal((await one()).status, 201, `order ${i + 1} should succeed`);
  const blocked = await one();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /too many orders/i);
});

await test("verify does not reveal whether an order number exists", async () => {
  const real = await (await post3("/api/orders", { customer: customer("9700000002"), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" }, { "cf-connecting-ip": "192.0.2.51" })).json();
  const bogus = await post3("/api/orders/verify", { orderId: "SA-260101-ZZZZZ" });
  const existing = await post3("/api/orders/verify", { orderId: real.order.id, razorpay_signature: "deadbeef" });
  assert.equal(bogus.status, existing.status, "status must match");
  assert.equal((await bogus.json()).error, (await existing.json()).error, "message must match");
});

await test("a changed admin password kills sessions issued before it", async () => {
  const ck = (await post3("/api/admin/login", { username: "zuhaib", password: "honey-admin-1" })).headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(t3.url + "/api/admin/summary", { headers: { cookie: ck } })).status, 200);
  t3.setPassword("zuhaib", "a-brand-new-password");
  assert.equal((await fetch(t3.url + "/api/admin/summary", { headers: { cookie: ck } })).status, 401);
});

await test("signing out everywhere kills sessions on other devices", async () => {
  const logIn = async () => (await post3("/api/admin/login", { username: "family", password: "honey-admin-2" })).headers.get("set-cookie").split(";")[0];
  const phone = await logIn(), laptop = await logIn();
  assert.equal((await fetch(t3.url + "/api/admin/summary", { headers: { cookie: phone } })).status, 200);
  const rv = await post3("/api/admin/revoke-sessions", {}, { cookie: laptop });
  assert.equal(rv.status, 200, "revoke failed: " + (await rv.text()));
  assert.equal((await fetch(t3.url + "/api/admin/summary", { headers: { cookie: phone } })).status, 401, "phone session must die");
  assert.equal((await fetch(t3.url + "/api/admin/summary", { headers: { cookie: laptop } })).status, 401, "laptop session must die too");
});

await test("one account is locked after repeated wrong passwords from new addresses", async () => {
  const tryLogin = i => post3("/api/admin/login", { username: "zuhaib", password: "nope" }, { "cf-connecting-ip": `203.0.113.${i}` });
  let sawLock = false;
  for (let i = 1; i <= 12; i++) if ((await tryLogin(i)).status === 429) { sawLock = true; break; }
  assert.ok(sawLock, "account lockout should fire even though every attempt came from a different address");
});

await test("a forged x-forwarded-for header does not reset the limits", async () => {
  const tryLogin = i => post3("/api/admin/login", { username: "family", password: "nope" },
    { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": `198.51.100.${i}` });
  let blocked = false;
  for (let i = 1; i <= 12; i++) if ((await tryLogin(i)).status === 429) { blocked = true; break; }
  assert.ok(blocked, "spoofing x-forwarded-for must not buy more attempts");
});

await test("an oversized webhook body is rejected before it is parsed", async () => {
  const r = await fetch(t3.url + "/api/webhooks/razorpay", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(200000) })
  });
  assert.equal(r.status, 413);
});

t3.close();

// Its own instance: the lockout tests above leave both accounts blocked, and a
// blocked account answers instantly, which would hide the very gap this measures.
const t4 = await start({ payments: false });
await test("a wrong username takes as long to answer as a wrong password", async () => {
  const time = async (username, i0) => {
    const runs = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      const r = await fetch(t4.url + "/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: t4.url, "cf-connecting-ip": `203.0.114.${i0 + i}` },
        body: JSON.stringify({ username, password: "definitely-wrong" })
      });
      assert.equal(r.status, 401, "expected a plain rejection, not a lockout");
      runs.push(performance.now() - t0);
    }
    return runs.sort((a, b) => a - b)[1];
  };
  const unknown = await time("no-such-admin", 10);
  const known = await time("zuhaib", 50);
  const ratio = Math.max(unknown, known) / Math.max(0.5, Math.min(unknown, known));
  assert.ok(ratio < 3, `timing gap leaks which usernames exist: unknown ${unknown.toFixed(1)}ms vs known ${known.toFixed(1)}ms`);
});
t4.close();

for (const [s, n, e] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n}${e ? "\n    " + e : ""}`);
const failed = results.filter(r => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
