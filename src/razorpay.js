import { hmacHex, safeEqual } from "./crypto.js";
import { HttpError } from "./http.js";

export const paymentsEnabled = env => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

// Razorpay requires an order to be created on the server for every payment.
// Payments made without an order are refunded automatically.
export async function createRazorpayOrder(env, { amount, receipt, notes }) {
  const base = env.RAZORPAY_API_BASE || "https://api.razorpay.com";
  const res = await fetch(`${base}/v1/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)
    },
    body: JSON.stringify({ amount, currency: "INR", receipt, notes })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Razorpay order creation failed", res.status, detail);
    throw new HttpError(502, "Online payment is not available right now. Please try again, or choose cash on delivery.");
  }
  return res.json();
}

// Checkout returns razorpay_signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export async function verifyPaymentSignature(env, razorpayOrderId, paymentId, signature) {
  if (!razorpayOrderId || !paymentId || !signature) return false;
  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${razorpayOrderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

// Webhooks are signed with the webhook secret over the raw request body.
export async function verifyWebhookSignature(env, rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, signature);
}
