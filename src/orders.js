import { PRICING, PRODUCTS } from "./catalog.js";
import { priceCart } from "./pricing.js";
import { HttpError } from "./http.js";
import { randomId } from "./crypto.js";
import { isPromoShape, checkPromo, claimPromo, releasePromo } from "./promo.js";
import { createRazorpayOrder, paymentsEnabled, verifyPaymentSignature, verifyWebhookSignature } from "./razorpay.js";

export const STATUSES = ["pending_payment", "placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
export const STATUS_LABEL = {
  pending_payment: "Awaiting payment", placed: "Order placed", confirmed: "Confirmed", packed: "Packed",
  shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled"
};
export const PAYMENT_LABEL = {
  pending: "Payment pending", paid: "Paid online", failed: "Payment failed",
  awaiting_link: "Awaiting payment link", cod: "Cash on delivery", refunded: "Refunded",
  advance_pending: "COD advance pending", advance_paid: "Advance paid, rest on delivery"
};

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function validateCustomer(c = {}) {
  const f = {
    name: clean(c.name, 80), phone: String(c.phone ?? "").replace(/\D/g, "").slice(-10),
    email: clean(c.email, 120), address: clean(c.address, 300), city: clean(c.city, 60), pin: String(c.pin ?? "").trim()
  };
  const errs = [];
  if (f.name.length < 2) errs.push("Enter your full name.");
  if (!/^[6-9]\d{9}$/.test(f.phone)) errs.push("Enter a 10-digit Indian mobile number.");
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errs.push("Check the email address, or leave it empty.");
  if (f.address.length < 8) errs.push("Enter your full delivery address.");
  if (f.city.length < 2) errs.push("Enter your city.");
  if (!/^[1-8]\d{5}$/.test(f.pin)) errs.push("Enter a valid 6-digit PIN code.");
  if (errs.length) throw new HttpError(400, errs.join(" "));
  return f;
}

async function newOrderId(env) {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST date in the ID
  const day = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  for (let i = 0; i < 5; i++) {
    const id = `SA-${day}-${randomId(5)}`;
    const exists = await env.DB.prepare("SELECT 1 FROM orders WHERE id = ?").bind(id).first();
    if (!exists) return id;
  }
  throw new HttpError(500, "Could not create an order number. Please try again.");
}

export function catalogResponse(env) {
  return {
    products: PRODUCTS.map(p => ({ id: p.id, name: p.name, gift: !!p.gift, variants: p.variants })),
    pricing: PRICING,
    payments: { online: paymentsEnabled(env), keyId: paymentsEnabled(env) ? env.RAZORPAY_KEY_ID : null }
  };
}

async function couponEligible(env, phone) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM orders WHERE phone = ? AND coupon = ? AND status NOT IN ('pending_payment','cancelled') LIMIT 1"
  ).bind(phone, PRICING.couponCode).first();
  return !row;
}

export async function createOrder(env, body, request) {
  const customer = validateCustomer(body.customer);
  const wanted = body.payment === "cod" ? "cod" : "online";
  const method = wanted === "online" && !paymentsEnabled(env) ? "link" : wanted;
  const code = String(body.coupon || "").trim().toUpperCase();
  const promo = isPromoShape(code) ? await checkPromo(env, request, code) : null;
  const priced = priceCart(body.items, {
    coupon: body.coupon, payment: method, couponEligible: await couponEligible(env, customer.phone), pin: customer.pin, promo
  });
  const id = await newOrderId(env);
  if (promo) await claimPromo(env, promo.code, id, customer.phone);
  try {
    return await saveOrder(env, body, { id, customer, method, priced });
  } catch (err) {
    if (promo) await releasePromo(env, id).run(); // order failed, so the code stays unused
    throw err;
  }
}

async function saveOrder(env, body, { id, customer, method, priced }) {
  const now = Date.now();

  // Online orders pay the full total now. COD orders pay the advance now (or by a
  // WhatsApp payment link when Razorpay isn't set up) and the rest on delivery.
  let razorpay = null;
  const payNow = method === "online" ? priced.total : method === "cod" ? priced.advance : 0;
  if (payNow && paymentsEnabled(env)) {
    const rzp = await createRazorpayOrder(env, {
      amount: payNow, receipt: id, notes: { order_id: id, phone: customer.phone, part: method === "cod" ? "cod_advance" : "full" }
    });
    razorpay = { keyId: env.RAZORPAY_KEY_ID, orderId: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" };
  }
  const status = method === "link" ? "placed" : "pending_payment";
  const paymentStatus = { online: "pending", link: "awaiting_link", cod: "advance_pending" }[method];
  const firstNote = method === "online" ? "Order created, waiting for payment"
    : method === "cod" ? `Order created, waiting for ${priced.advancePct}% advance (${rupees(priced.advance)})` : "Order placed";

  const stmts = [
    env.DB.prepare(`INSERT INTO orders (id, created_at, updated_at, status, payment_method, payment_status, name, phone, email,
      address, city, pin, gift_note, coupon, discount_label, subtotal, discount, shipping, cod_fee, total, advance, razorpay_order_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id, now, now, status, method, paymentStatus, customer.name, customer.phone, customer.email || null,
      customer.address, customer.city, customer.pin, clean(body.gift, 140) || null, priced.coupon, priced.discountLabel || null,
      priced.subtotal, priced.discount, priced.shipping, priced.codFee, priced.total, priced.advance, razorpay?.orderId || null),
    ...priced.lines.map(l => env.DB.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label, qty,
      unit_price, subscription, line_total) VALUES (?,?,?,?,?,?,?,?,?)`).bind(
      id, l.product_id, l.variant_id, l.name, l.variant_label, l.qty, l.unit_price, l.subscription, l.line_total)),
    env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,1)").bind(
      id, now, status, firstNote, "customer")
  ];
  await env.DB.batch(stmts);

  return { order: await loadPublicOrder(env, id), razorpay, couponRejected: priced.couponRejected };
}

export async function verifyPayment(env, body) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(String(body.orderId || "")).first();
  if (!order || !["online", "cod"].includes(order.payment_method)) throw new HttpError(404, "Order not found.");
  if (["paid", "advance_paid"].includes(order.payment_status)) return { order: await loadPublicOrder(env, order.id) };
  // Use the Razorpay order ID stored on our side, not the one sent by the browser.
  const valid = body.razorpay_order_id === order.razorpay_order_id &&
    await verifyPaymentSignature(env, order.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature);
  if (!valid) throw new HttpError(400, "We could not confirm this payment. If money was deducted, it will be refunded automatically, or message us with your order number.");
  await markPaid(env, order, String(body.razorpay_payment_id), "customer");
  return { order: await loadPublicOrder(env, order.id) };
}

// Razorpay confirmed a payment: the full total for online orders, the advance for COD orders.
async function markPaid(env, order, paymentId, actor) {
  const now = Date.now();
  const newStatus = order.status === "pending_payment" ? "placed" : order.status;
  const advance = order.payment_method === "cod" && order.advance > 0;
  const res = await env.DB.prepare(`UPDATE orders SET payment_status = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id),
      paid_at = ?, status = ?, updated_at = ? WHERE id = ? AND payment_status NOT IN ('paid','advance_paid')`)
    .bind(advance ? "advance_paid" : "paid", paymentId || null, now, newStatus, now, order.id).run();
  if (res.meta?.changes) {
    await env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,1)")
      .bind(order.id, now, newStatus, advance ? advanceNote(order) : "Payment received", actor).run();
  }
}
export const rupees = paise => "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const advanceNote = o => `Advance of ${rupees(o.advance)} received. ${rupees(o.total - o.advance)} to pay on delivery`;

export async function handleWebhook(env, request) {
  const raw = await request.text();
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new HttpError(503, "Webhook secret not configured.");
  if (!await verifyWebhookSignature(env, raw, request.headers.get("x-razorpay-signature"))) throw new HttpError(400, "Invalid signature.");
  const evt = JSON.parse(raw);
  const payment = evt.payload?.payment?.entity;
  const rzpOrderId = payment?.order_id || evt.payload?.order?.entity?.id;
  if (!rzpOrderId) return { ok: true, ignored: true };
  const order = await env.DB.prepare("SELECT * FROM orders WHERE razorpay_order_id = ?").bind(rzpOrderId).first();
  if (!order) return { ok: true, ignored: true };
  if (evt.event === "payment.captured" || evt.event === "order.paid") {
    await markPaid(env, order, payment?.id, "razorpay");
  } else if (evt.event === "payment.failed" && order.payment_status === "advance_pending") {
    await env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,0)")
      .bind(order.id, Date.now(), order.status, `Advance payment attempt failed: ${clean(payment?.error_description, 200) || "unknown reason"}`, "razorpay").run();
  } else if (evt.event === "payment.failed" && order.payment_status === "pending") {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status = 'pending'").bind(now, order.id),
      env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,0)")
        .bind(order.id, now, order.status, `Payment attempt failed: ${clean(payment?.error_description, 200) || "unknown reason"}`, "razorpay")
    ]);
  }
  return { ok: true };
}

export async function loadPublicOrder(env, id) {
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!o) return null;
  const items = (await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(id).all()).results;
  const events = (await env.DB.prepare("SELECT at, status, note FROM order_events WHERE order_id = ? AND public = 1 ORDER BY at, id").bind(id).all()).results;
  return {
    id: o.id, createdAt: o.created_at, status: o.status, statusLabel: STATUS_LABEL[o.status] || o.status,
    paymentMethod: o.payment_method, paymentStatus: o.payment_status, paymentLabel: PAYMENT_LABEL[o.payment_status] || o.payment_status,
    city: o.city, pin: o.pin, name: o.name.split(" ")[0],
    items: items.map(i => ({ pid: i.product_id, vid: i.variant_id, name: i.name, variant: i.variant_label, qty: i.qty, sub: !!i.subscription, lineTotal: i.line_total })),
    subtotal: o.subtotal, discount: o.discount, discountLabel: o.discount_label, shipping: o.shipping, codFee: o.cod_fee, total: o.total,
    advance: o.advance || 0, balance: o.advance ? o.total - o.advance : 0,
    courier: o.courier, awb: o.awb, trackingUrl: o.tracking_url,
    razorpayOrderId: ["pending", "failed", "advance_pending"].includes(o.payment_status) ? o.razorpay_order_id : null,
    events: events.map(e => ({ at: e.at, status: e.status, label: STATUS_LABEL[e.status] || e.status, note: e.note }))
  };
}

export async function trackOrder(env, id, phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  const row = await env.DB.prepare("SELECT phone FROM orders WHERE id = ?").bind(String(id).toUpperCase()).first();
  if (!row || row.phone !== digits) throw new HttpError(404, "No order found with that order number and mobile number.");
  return loadPublicOrder(env, String(id).toUpperCase());
}
