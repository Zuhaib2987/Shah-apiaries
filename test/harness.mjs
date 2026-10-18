// Local test harness: runs the Worker in Node with an in-memory SQLite stand-in
// for D1, a static file server for ./public, and a fake Razorpay API.
// (On Cloudflare, `npm run dev` / wrangler does all of this for real.)
import http from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { pbkdf2Sync, randomBytes, createHmac } from "node:crypto";
import worker from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args); return r ? (col ? r[col] : { ...r }) : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map(r => ({ ...r })) }; }
  async run() { return this._run(); }
  _run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const f of readdirSync(join(root, "migrations")).sort()) this.db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try { const out = stmts.map(s => s._run()); this.db.exec("COMMIT"); return out; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const assets = {
  async fetch(request) {
    let p = new URL(request.url).pathname;
    let file = join(root, "public", p);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    else if (!extname(file) && existsSync(file + ".html")) file += ".html";
    if (!existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] || "application/octet-stream" } });
  }
};

export const hashPassword = pw => {
  const salt = randomBytes(16);
  return `pbkdf2_sha256$100000$${salt.toString("base64")}$${pbkdf2Sync(pw, salt, 100000, 32, "sha256").toString("base64")}`;
};

function listen(server, port) { return new Promise(r => server.listen(port, "127.0.0.1", () => r(server.address().port))); }

export async function start({ port = 0, payments = true } = {}) {
  // Fake Razorpay
  const rzpOrders = [];
  const rzp = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      if (req.url === "/v1/orders" && req.method === "POST" && req.headers.authorization === "Basic " + Buffer.from("rzp_test_mock:mocksecret").toString("base64")) {
        const b = JSON.parse(body);
        const o = { id: "order_" + randomBytes(7).toString("hex"), entity: "order", amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" };
        rzpOrders.push(o);
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o));
      } else { res.writeHead(401); res.end('{"error":{"description":"auth failed"}}'); }
    });
  });
  const rzpPort = await listen(rzp, 0);

  const env = {
    DB: new FakeD1(), ASSETS: assets, SITE_URL: "http://localhost",
    SESSION_SECRET: "test-session-secret-that-is-long-enough-1234567890",
    ADMIN_USERS: JSON.stringify({ zuhaib: hashPassword("honey-admin-1"), family: hashPassword("honey-admin-2") }),
    RAZORPAY_WEBHOOK_SECRET: "whsecret",
    RAZORPAY_API_BASE: `http://127.0.0.1:${rzpPort}`,
    ...(payments ? { RAZORPAY_KEY_ID: "rzp_test_mock", RAZORPAY_KEY_SECRET: "mocksecret" } : {})
  };

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const request = new Request(`http://localhost:${server.address().port}${req.url}`, {
      method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
    });
    const response = await worker.fetch(request, env);
    const out = {}; response.headers.forEach((v, k) => { if (k !== "set-cookie") out[k] = v; });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  const appPort = await listen(server, port);

  return {
    env, rzpOrders, url: `http://localhost:${appPort}`,
    sign: (orderId, paymentId) => createHmac("sha256", "mocksecret").update(`${orderId}|${paymentId}`).digest("hex"),
    signWebhook: body => createHmac("sha256", "whsecret").update(body).digest("hex"),
    close: () => { server.close(); rzp.close(); }
  };
}

// `node test/harness.mjs` starts a local server you can open in a browser.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = await start({ port: Number(process.env.PORT) || 8787 });
  console.log(`Shop:  ${t.url}\nAdmin: ${t.url}/admin  (zuhaib / honey-admin-1)`);
}
