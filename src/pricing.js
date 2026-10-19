import { PRICING, findVariant, isJK } from "./catalog.js";
import { HttpError } from "./http.js";

// Recalculates an order on the server. All amounts returned are in paise.
export function priceCart(items, { coupon = "", payment = "online", couponEligible = true, pin = "" } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "Your cart is empty.");
  if (items.length > 30) throw new HttpError(400, "Too many items in one order. Please contact us for bulk orders.");

  const lines = [];
  for (const raw of items) {
    const found = findVariant(String(raw?.pid || ""), String(raw?.vid || ""));
    if (!found) throw new HttpError(400, "One of the items in your cart is no longer available. Please refresh the page.");
    const { product, variant } = found;
    if (!variant.stock) throw new HttpError(409, `${product.name}, ${variant.label} is sold out. Please remove it from your cart.`);
    const qty = Math.floor(Number(raw.qty));
    if (!(qty >= 1 && qty <= PRICING.maxQtyPerLine)) throw new HttpError(400, `Quantity must be between 1 and ${PRICING.maxQtyPerLine}.`);
    const subscription = !!raw.sub && !product.gift;
    const unit = Math.round(variant.price * 100 * (subscription ? (100 - PRICING.subscribePct) / 100 : 1));
    lines.push({
      product_id: product.id, variant_id: variant.id, name: product.name, variant_label: variant.label,
      qty, unit_price: unit, subscription: subscription ? 1 : 0, line_total: unit * qty
    });
  }

  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);
  const code = String(coupon || "").trim().toUpperCase();
  const couponValid = code !== "" && code === PRICING.couponCode;
  const couponDisc = couponValid && couponEligible ? Math.round(subtotal * PRICING.couponPct / 100) : 0;
  const bulkDisc = itemCount >= PRICING.bulkMinItems ? Math.round(subtotal * PRICING.bulkPct / 100) : 0;
  const discount = Math.max(couponDisc, bulkDisc);
  const couponApplied = discount > 0 && couponDisc >= bulkDisc;
  const discountLabel = !discount ? "" : couponApplied
    ? `Coupon ${PRICING.couponCode} (−${PRICING.couponPct}%)`
    : `Buy ${PRICING.bulkMinItems}+ saving (−${PRICING.bulkPct}%)`;
  const afterDiscount = subtotal - discount;
  const shipping = afterDiscount >= PRICING.freeShippingAbove * 100 ? 0 : PRICING.shippingFee * 100;
  const codFee = payment === "cod" ? PRICING.codFee * 100 : 0;
  const total = afterDiscount + shipping + codFee;
  // COD: part of the total is paid online first, rounded up to whole rupees.
  const advancePct = payment === "cod" ? (isJK(pin) ? PRICING.codAdvancePctJK : PRICING.codAdvancePct) : 0;
  const advance = advancePct ? Math.min(total, Math.ceil(total * advancePct / 10000) * 100) : 0;

  return {
    lines, itemCount, subtotal, discount, discountLabel,
    coupon: couponApplied ? PRICING.couponCode : null,
    couponRejected: couponValid && !couponEligible,
    shipping, codFee, total, advancePct, advance
  };
}
