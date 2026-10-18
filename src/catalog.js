// Single source of truth for prices, sizes, stock and order rules.
// The storefront reads these from /api/catalog, and every order total is
// recalculated here on the server, so prices cannot be changed in the browser.
//
// Prices are in rupees. Change a price or stock flag, push to GitHub, and the
// site updates automatically.

export const PRICING = {
  currency: "INR",
  freeShippingAbove: 999, // ₹, after discounts
  shippingFee: 80,        // ₹ below the free-shipping threshold
  codFee: 40,             // ₹ extra for cash on delivery
  couponCode: "WELCOME10",
  couponPct: 10,          // first order only (checked by mobile number)
  bulkMinItems: 3,        // buy this many items or more...
  bulkPct: 10,            // ...and save this %. Coupon and bulk do not stack; the bigger saving applies.
  subscribePct: 10,       // "every month" option on single honeys
  maxQtyPerLine: 20
};

export const PRODUCTS = [
  {
    id: "acacia", name: "Acacia Honey",
    variants: [
      { id: "500", label: "500 g", price: 749, mrp: 799, stock: true },
      { id: "1kg", label: "1 kg", price: 1449, mrp: 1598, stock: true }
    ]
  },
  {
    id: "sulai", name: "Sulai Honey",
    variants: [
      { id: "500", label: "500 g", price: 899, mrp: 949, stock: true },
      { id: "1kg", label: "1 kg", price: 1749, mrp: 1898, stock: false }
    ]
  },
  {
    id: "multiflora", name: "Gurez Multi-Floral",
    variants: [
      { id: "500", label: "500 g", price: 649, mrp: 699, stock: true },
      { id: "1kg", label: "1 kg", price: 1249, mrp: 1398, stock: true }
    ]
  },
  {
    id: "trio", name: "The Valley Trio", gift: true,
    variants: [{ id: "box", label: "Gift box, 3 × 500 g", price: 2149, mrp: 2297, stock: true }]
  },
  {
    id: "minis", name: "Tasting Set", gift: true,
    variants: [{ id: "set", label: "3 × 100 g", price: 549, mrp: 599, stock: true }]
  }
];

export function findVariant(pid, vid) {
  const product = PRODUCTS.find(p => p.id === pid);
  const variant = product?.variants.find(v => v.id === vid);
  return product && variant ? { product, variant } : null;
}
