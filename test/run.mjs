// API tests. Run with: npm test
import assert from "node:assert/strict";
import { start } from "./harness.mjs";

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["ok", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}

const t = await start();
const H = { "content-type": "application/json", origin: t.url };
const post = (path, body, headers = {}) => fetch(t.url + path, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const customer = (phone = "9876543210") => ({ name: "Test Buyer", phone, email: "", address: "House 12, Main Road, Rajbagh", city: "Srinagar", pin: "190008" });

let codId, onlineOrder, adminCookie;

await test("catalog lists products and online payments", async () => {
  const r = await fetch(t.url + "/api/catalog"); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.products.length, 5); assert.equal(j.payments.online, true); assert.equal(j.payments.keyId, "rzp_test_mock");
});

await test("COD order is placed with correct total", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  assert.equal(j.order.status, "placed"); assert.equal(j.order.paymentStatus, "cod");
  assert.equal(j.order.total, (749 + 80 + 40) * 100); assert.equal(j.razorpay, null);
  codId = j.order.id; assert.match(codId, /^SA-\d{6}-[A-Z0-9]{5}$/);
});

await test("browser cannot change prices", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1, price: 1 }], payment: "cod" });
  assert.equal((await r.json()).order.subtotal, 74900);
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
  const sub = (749 + 899 + 1249) * 100, disc = Math.round(sub * 0.1);
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
  assert.equal(first.order.discount, Math.round(74900 * 0.1));
  const second = await (await post("/api/orders", { customer: customer("9555555555"), items: [{ pid: "acacia", vid: "500", qty: 1 }], coupon: "WELCOME10", payment: "cod" })).json();
  assert.equal(second.order.discount, 0); assert.equal(second.couponRejected, true);
});

await test("tracking needs the right mobile number", async () => {
  assert.equal((await fetch(`${t.url}/api/orders/${codId}?phone=9999999999`)).status, 404);
  const j = await (await fetch(`${t.url}/api/orders/${codId}?phone=9876543210`)).json();
  assert.equal(j.order.id, codId); assert.equal(j.order.events.length, 1);
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
  const o = await (await post("/api/orders", { customer: customer("9444444444"), items: [{ pid: "minis", vid: "set", qty: 1 }], payment: "online" })).json();
  assert.equal((await post(`/api/admin/orders/${o.order.id}`, { status: "packed" }, { cookie: adminCookie })).status, 409);
  const paid = await (await post(`/api/admin/orders/${o.order.id}`, { markPaid: true }, { cookie: adminCookie })).json();
  assert.equal(paid.order.payment_status, "paid"); assert.equal(paid.order.status, "placed");
});

await test("logged-out cookie is rejected", async () => {
  const r = await post("/api/admin/logout", {}, { cookie: adminCookie });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  const forged = adminCookie.replace(/.$/, c => (c === "a" ? "b" : "a"));
  assert.equal((await fetch(t.url + "/api/admin/orders", { headers: { cookie: forged } })).status, 401);
});

await test("too many wrong logins are blocked", async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await post("/api/admin/login", { username: "zuhaib", password: "bad" + i });
  assert.equal(last.status, 429);
});

await test("storefront and admin pages are served", async () => {
  const shop = await fetch(t.url + "/"); assert.equal(shop.status, 200); assert.match(await shop.text(), /Shah Apiaries/);
  const admin = await fetch(t.url + "/admin"); assert.equal(admin.status, 200); assert.match(await admin.text(), /Orders/);
});
t.close();

const t2 = await start({ payments: false });
await test("without Razorpay keys, online order becomes a payment-link order", async () => {
  const r = await fetch(t2.url + "/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: customer(), items: [{ pid: "acacia", vid: "1kg", qty: 1 }], payment: "online" }) });
  const j = await r.json(); assert.equal(r.status, 201);
  assert.equal(j.order.paymentMethod, "link"); assert.equal(j.order.status, "placed"); assert.equal(j.razorpay, null);
});
t2.close();

for (const [s, n, e] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n}${e ? "\n    " + e : ""}`);
const failed = results.filter(r => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
