import { HttpError } from "./http.js";
import { STATUSES, STATUS_LABEL, PAYMENT_LABEL } from "./orders.js";

const clean = (v, max) => String(v ?? "").trim().slice(0, max);

export async function summary(env) {
  const counts = (await env.DB.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all()).results;
  const dayStart = (() => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 5.5 * 3600e3; })();
  const today = await env.DB.prepare(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE created_at >= ? AND status NOT IN ('pending_payment','cancelled')"
  ).bind(dayStart).first();
  const week = await env.DB.prepare(
    "SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE created_at >= ? AND status NOT IN ('pending_payment','cancelled')"
  ).bind(dayStart - 6 * 86400e3).first();
  return {
    counts: Object.fromEntries(STATUSES.map(s => [s, counts.find(c => c.status === s)?.n || 0])),
    today, week, statusLabels: STATUS_LABEL, paymentLabels: PAYMENT_LABEL
  };
}

export async function listOrders(env, params) {
  const status = params.get("status") || "";
  const q = clean(params.get("q"), 60);
  const page = Math.max(0, Number(params.get("page")) || 0);
  const where = []; const binds = [];
  if (status === "open") where.push("status IN ('placed','confirmed','packed')");
  else if (STATUSES.includes(status)) { where.push("status = ?"); binds.push(status); }
  if (q) {
    where.push("(id LIKE ? OR name LIKE ? OR phone LIKE ? OR city LIKE ?)");
    const like = `%${q}%`; binds.push(like.toUpperCase(), like, like, like);
  }
  const sql = `SELECT id, created_at, status, payment_method, payment_status, name, phone, city, total,
      (SELECT SUM(qty) FROM order_items WHERE order_id = orders.id) AS items
    FROM orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 51 OFFSET ?`;
  const rows = (await env.DB.prepare(sql).bind(...binds, page * 50).all()).results;
  return { orders: rows.slice(0, 50), more: rows.length > 50 };
}

export async function getOrder(env, id) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) throw new HttpError(404, "Order not found.");
  const items = (await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(id).all()).results;
  const events = (await env.DB.prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY at, id").bind(id).all()).results;
  return { order, items, events };
}

export async function updateOrder(env, id, body, admin) {
  const { order } = await getOrder(env, id);
  const now = Date.now();
  const sets = []; const binds = []; const notes = [];
  let newStatus = order.status;

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status) || body.status === "pending_payment") throw new HttpError(400, "Unknown status.");
    if (order.status === "pending_payment" && body.status !== "cancelled" && order.payment_status !== "paid")
      throw new HttpError(409, "This order has not been paid yet. Mark it paid first, or cancel it.");
    newStatus = body.status;
    sets.push("status = ?"); binds.push(newStatus);
  }
  for (const [field, max] of [["courier", 60], ["awb", 60], ["tracking_url", 300], ["admin_note", 1000]]) {
    if (body[field] !== undefined) {
      let v = clean(body[field], max) || null;
      if (field === "tracking_url" && v && !/^https:\/\//i.test(v)) throw new HttpError(400, "Tracking link must start with https://");
      sets.push(`${field} = ?`); binds.push(v);
    }
  }
  if (body.markPaid) {
    if (order.payment_status === "paid") throw new HttpError(409, "Already marked as paid.");
    sets.push("payment_status = 'paid'", "paid_at = ?"); binds.push(now);
    if (order.status === "pending_payment") { newStatus = "placed"; sets.push("status = 'placed'"); }
    notes.push({ text: "Payment received", pub: 1 });
  }
  if (!sets.length && !body.note) throw new HttpError(400, "Nothing to update.");

  const stmts = [];
  if (sets.length) stmts.push(env.DB.prepare(`UPDATE orders SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...binds, now, id));
  if (newStatus !== order.status) {
    const shipNote = newStatus === "shipped" && (body.courier || body.awb) ? `${clean(body.courier, 60)} ${clean(body.awb, 60)}`.trim() : null;
    stmts.push(env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,1)")
      .bind(id, now, newStatus, shipNote, admin));
  }
  for (const n of notes) stmts.push(env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,?)")
    .bind(id, now, newStatus, n.text, admin, n.pub));
  if (body.note) stmts.push(env.DB.prepare("INSERT INTO order_events (order_id, at, status, note, actor, public) VALUES (?,?,?,?,?,?)")
    .bind(id, now, newStatus, clean(body.note, 500), admin, body.notePublic ? 1 : 0));
  await env.DB.batch(stmts);
  return getOrder(env, id);
}

export async function deleteOrder(env, id) {
  const order = await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(id).first();
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.status !== "cancelled") throw new HttpError(409, "Cancel the order first, then delete it.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM order_events WHERE order_id = ?").bind(id),
    env.DB.prepare("DELETE FROM order_items WHERE order_id = ?").bind(id),
    env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(id)
  ]);
  return { deleted: id };
}
