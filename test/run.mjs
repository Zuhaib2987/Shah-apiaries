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

let codId, onlineOrder, adminCookie, promoCodes = [];

await test("catalog lists products and online payments", async () => {
  const r = await fetch(t.url + "/api/catalog"); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.products.length, 5); assert.equal(j.payments.online, true); assert.equal(j.payments.keyId, "rzp_test_mock");
});

const payAdvance = async j => {
  const pid = "pay_ADV" + j.order.id.slice(-5);
  const r = await post("/api/orders/verify", { orderId: j.order.id, razorpay_order_id: j.razorpay.orderId, razorpay_payment_id: pid, razorpay_signature: t.sign(j.razorpay.orderId, pid) });
  return r.json();
};

await test("J&K COD order asks for a 20% advance online", async () => {
  const r = await post("/api/orders", { customer: customer(), items: [{ pid: "acacia", vid: "500", qty: 1 }], payment: "cod" });
  const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
  assert.equal(j.order.total, (749 + 80 + 40) * 100);
  assert.equal(j.order.advance, 17400); assert.equal(j.order.balance, 86900 - 17400); // 20% of 869 = 173.8, rounded up
  assert.equal(j.order.status, "pending_payment"); assert.equal(j.order.paymentStatus, "advance_pending");
  assert.equal(j.razorpay.amount, 17400);
  codId = j.order.id; assert.match(codId, /^SA-\d{6}-[A-Z0-9]{5}$/);
  const paid = await payAdvance(j);
  assert.equal(paid.order.paymentStatus, "advance_paid"); assert.equal(paid.order.status, "placed");
  assert.match(paid.order.events.at(-1).note, /₹174 received\. ₹695 to pay on delivery/);
});

await test("COD outside J&K asks for a 50% advance (Ladakh counts as outside)", async () => {
  for (const pin of ["110001", "194101"]) {
    const j = await (await post("/api/orders", { customer: { ...customer("9811111111"), pin }, items: [{ pid: "sulai", vid: "500", qty: 1 }], payment: "cod" })).json();
    assert.equal(j.order.total, (899 + 80 + 40) * 100);
    assert.equal(j.order.advance, 51000); assert.equal(j.razorpay.amount, 51000); // 50% of 1019 = 509.5, rounded up
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
  const o = await (await post("/api/orders", { customer: customer("9444444444"), items: [{ pid: "minis", vid: "set", qty: 1 }], payment: "online" })).json();
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
  assert.equal(j1.order.discount, Math.round(144900 * 0.2)); assert.match(j1.order.discountLabel, /Friends & family/);
  const r2 = await order(); assert.equal(r2.status, 409);
  assert.equal((await post("/api/coupons/check", { code })).status, 409);
  const list = await (await fetch(t.url + "/api/admin/codes", { headers: { cookie: adminCookie } })).json();
  assert.equal(list.codes.find(c => c.code === code).used_order_id, j1.order.id);
  await post(`/api/admin/orders/${j1.order.id}`, { status: "cancelled" }, { cookie: adminCookie });
  const r3 = await order(); assert.equal(r3.status, 201);
});

await test("friends & family code beats the buy-3 saving and does not block WELCOME10 later", async () => {
  const r = await post("/api/orders", { customer: customer("9844444444"), items: [{ pid: "acacia", vid: "500", qty: 3 }], coupon: promoCodes[1], payment: "online" });
  const j = await r.json(); assert.equal(j.order.discount, Math.round(74900 * 3 * 0.2));
  await post("/api/orders/verify", { orderId: j.order.id, razorpay_order_id: j.razorpay.orderId, razorpay_payment_id: "pay_PR1", razorpay_signature: t.sign(j.razorpay.orderId, "pay_PR1") });
  const w = await (await post("/api/orders", { customer: customer("9844444444"), items: [{ pid: "acacia", vid: "500", qty: 1 }], coupon: "WELCOME10", payment: "online" })).json();
  assert.equal(w.order.discount, Math.round(74900 * 0.1));
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
  assert.equal(j.razorpay, null); assert.equal(j.order.paymentStatus, "advance_pending"); assert.equal(j.order.advance, 17400);
  const ck = (await fetch(t2.url + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "zuhaib", password: "honey-admin-1" }) })).headers.get("set-cookie").split(";")[0];
  const mark = async () => (await fetch(`${t2.url}/api/admin/orders/${j.order.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ markPaid: true }) })).json();
  const a = await mark(); assert.equal(a.order.payment_status, "advance_paid"); assert.equal(a.order.status, "placed");
  const b = await mark(); assert.equal(b.order.payment_status, "paid");
});
t2.close();

for (const [s, n, e] of results) console.log(`${s === "ok" ? "✓" : "✗"} ${n}${e ? "\n    " + e : ""}`);
const failed = results.filter(r => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
