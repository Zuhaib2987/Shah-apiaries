# Shah Apiaries

Website, order system and admin dashboard for Shah Apiaries, raw honey from Kashmir.

Runs entirely on **Cloudflare** (free plan): the shop, the API and the database.

| Part | Where | What it does |
|---|---|---|
| Shop | `public/index.html` | Storefront, cart, checkout, order tracking |
| Admin | `public/admin/index.html` → `shahapiaries.in/admin` | Orders, status updates, shipping, payments |
| API | `src/` | Creates orders, Razorpay payments, tracking, admin login |
| Prices and stock | `src/catalog.js` | Single source of truth for prices, sizes, stock, shipping, coupon |
| Database | `migrations/` | Orders, items, status history (Cloudflare D1) |

---

## Everyday tasks

**Change a price, size or stock:** edit `src/catalog.js` on GitHub and commit. The site updates in about a minute.

**Manage orders:** open `https://shahapiaries.in/admin` on any phone or laptop.

1. **Needs action** lists new orders.
2. Tap an order, then **Confirm order** → **Mark packed** → **Mark shipped** (add courier and tracking number) → **Mark delivered**.
3. **WhatsApp update** opens WhatsApp with a ready message and tracking link for the customer.
4. Cash on delivery and payment-link orders: tap **Mark paid** once money arrives.
5. Notes are private unless you tick "Show this note to the customer".

**Customers track orders** under *My orders* on the shop, or with a link like `https://shahapiaries.in/#track-SA-261018-7K3QX`.

---

## One-time setup

### 1. Domain on Cloudflare
1. Create a free account at cloudflare.com and add **shahapiaries.in** (Free plan).
2. In GoDaddy: My Products → shahapiaries.in → DNS → Nameservers → Change → enter the 2 Cloudflare nameservers.

### 2. Database
1. Cloudflare dashboard → **Storage & Databases → D1** → **Create database** → name it `shah-apiaries`.
2. Copy the **Database ID**.
3. In this repo, edit `wrangler.jsonc` and replace `PASTE_D1_DATABASE_ID_HERE` with it. Commit.
4. Open the database → **Console**, paste the whole of `migrations/0001_init.sql`, and run it. (This creates the tables. The deploy command also applies migrations; running it here once is the safe fallback.)

### 3. Admin passwords
On a computer with Node.js installed, in this folder:

```
npm run hash-password -- zuhaib "a-long-password-here"
npm run hash-password -- family "another-long-password"
```

Combine the two printed lines into one value, for example:

```
{"zuhaib":"pbkdf2_sha256$100000$...","family":"pbkdf2_sha256$100000$..."}
```

Passwords are never stored, only these hashes.

### 4. Connect GitHub to Cloudflare
1. Cloudflare → **Workers & Pages → Create → Import a repository** → pick `shah-apiaries`.
2. Deploy command: `npm run deploy`
3. Deploy.

### 5. Secrets
Worker → **Settings → Variables and Secrets** → add each as type **Secret**:

| Name | Value |
|---|---|
| `SESSION_SECRET` | Any random text, 40+ characters |
| `ADMIN_USERS` | The JSON from step 3 |
| `RAZORPAY_KEY_ID` | From Razorpay (step 7) |
| `RAZORPAY_KEY_SECRET` | From Razorpay (step 7) |
| `RAZORPAY_WEBHOOK_SECRET` | Any random text; same value goes in Razorpay (step 7) |

Without the Razorpay keys the site still works: online orders become **payment-link orders** (you send a Razorpay payment link on WhatsApp, then tap Mark paid).

### 6. Custom domain
Worker → **Settings → Domains & Routes → Add → Custom domain** → `shahapiaries.in`, then again for `www.shahapiaries.in`.

### 7. Razorpay
1. Sign up at razorpay.com. **Test mode** keys work immediately; live keys after KYC approval.
2. Account & Settings → **API Keys** → generate → put Key ID and Key Secret into the secrets above.
3. Account & Settings → **Webhooks** → Add:
   - URL: `https://shahapiaries.in/api/webhooks/razorpay`
   - Secret: same as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `order.paid`, `payment.failed`
4. Account & Settings → **Payment capture** → Automatic.
5. After activation, switch the two key secrets (and the webhook) to **live** mode.

Test card details for test mode are listed in Razorpay's docs. No real money moves in test mode.

### 8. Before launch
In `public/index.html`, near the top of the script (`CONFIG`):
1. `whatsapp`: business number with 91, digits only.
2. `fssai`: licence number.
3. `demoMode: false` to hide sample reviews and sample lab reports.
4. Real lab reports in `LAB_REPORTS`.

---

## How payments stay safe
1. Prices are recalculated on the server from `src/catalog.js`. Changing a price in the browser has no effect.
2. Every online payment gets a Razorpay order created on the server with the secret key.
3. The payment signature is checked on the server before an order is marked paid. The webhook is a second, independent confirmation.
4. Admin login uses hashed passwords, a signed HttpOnly cookie, and blocks an IP after 8 wrong attempts in 15 minutes.
5. Requests from other websites are rejected.

## Local development
```
npm install
cp .dev.vars.example .dev.vars   # fill in test values
npm run dev                      # http://localhost:8787
npm test                         # API tests (Node 22+)
```
