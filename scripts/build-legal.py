# Builds the policy pages in public/ (privacy, terms, refunds, shipping, contact).
# Edit the text here, then run: python3 scripts/build-legal.py
import re, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
UPDATED = "20 October 2026"
LEAF = "M50 3 L52.5 8 L54.5 13 L57.5 13.5 L56.5 18 L58.5 24 L61.5 24.5 L60 29 L60.5 35 L59 41 L58 45 L62 40 L66.5 35.5 L70.5 31 L71 27 L74.5 28 L79.5 23.5 L82.5 19 L84.5 21 L89.5 16.5 L94 14 L91.5 19 L88.5 24 L86.5 25 L87.5 28 L83.5 31 L79.5 35.5 L81.5 38 L77 40 L73 45.5 L70 50.5 L75 49.5 L80.5 48.5 L83.5 45.5 L85.5 48.5 L91.5 50.5 L98 54.5 L92.5 57.5 L87 59.5 L88 63 L83 63.5 L76.5 64.5 L71 66.5 L65 70.5 L58.5 71 L53 68.5 L51.2 69 L51.6 88 L50 91 L48.4 88 L48.8 69 L47 68.5 L41.5 71 L35 70.5 L29 66.5 L23.5 64.5 L17 63.5 L12 63 L13 59.5 L7.5 57.5 L2 54.5 L8.5 50.5 L14.5 48.5 L16.5 45.5 L19.5 48.5 L25 49.5 L30 50.5 L27 45.5 L23 40 L18.5 38 L20.5 35.5 L16.5 31 L12.5 28 L13.5 25 L11.5 24 L8.5 19 L6 14 L10.5 16.5 L15.5 21 L17.5 19 L20.5 23.5 L25.5 28 L29 27 L29.5 31 L33.5 35.5 L38 40 L42 45 L41 41 L39.5 35 L40 29 L38.5 24.5 L41.5 24 L43.5 18 L42.5 13.5 L45.5 13 L47.5 8 L50 3Z"
COMB = "M33 64 41 68.6v9.2L33 82.4 25 77.8v-9.2zM50 64 58 68.6v9.2L50 82.4 42 77.8v-9.2zM67 64 75 68.6v9.2L67 82.4 59 77.8v-9.2zM41.5 49.5 49.5 54.1v9.2L41.5 67.9 33.5 63.3v-9.2zM58.5 49.5 66.5 54.1v9.2L58.5 67.9 50.5 63.3v-9.2zM50 35 58 39.6v9.2L50 53.4 42 48.8v-9.2z"

BIZ = "Shah Apiaries™"
OWNER = "Zuhaib Muzaffar Shah"
ADDR = "Babapora, Zoonimar, Srinagar, Jammu &amp; Kashmir, India"
EMAIL = "ShahApiaries@gmail.com"
FSSAI = "21026414000454"

def cfg(key, default, kind=""):
    return f'<span data-cfg="{key}{":"+kind if kind else ""}">{default}</span>'
COD_FEE = cfg("codFee","₹40","rupees"); ADV = cfg("codAdvancePct","50%","pct"); ADV_JK = cfg("codAdvancePctJK","20%","pct")
FREE = cfg("freeShippingAbove","₹999","rupees"); SHIP = cfg("shippingFee","₹80","rupees")
CPCT = cfg("couponPct","10%","pct"); CCODE = cfg("couponCode","WELCOME10"); PPCT = cfg("promoPct","20%","pct")
BULKN = cfg("bulkMinItems","3"); BULKP = cfg("bulkPct","10%","pct"); SUBP = cfg("subscribePct","10%","pct")

PAGES = [("privacy","Privacy policy"),("terms","Terms &amp; conditions"),("refund-policy","Refunds &amp; cancellations"),("shipping-policy","Shipping policy"),("contact","Contact &amp; grievances")]

def page(slug, title, eyebrow, intro, summary, sections):
    toc = "".join(f'<li><a href="#{sid}">{re.sub(r"^\d+\.\s*","",h)}</a></li>' for sid,h,_ in sections)
    body = "".join(f'<h2 id="{sid}">{h}</h2>{html}' for sid,h,html in sections)
    nav = "".join(f'<a href="/{s}"{" aria-current=\"page\"" if s==slug else ""}>{t}</a>' for s,t in PAGES)
    plain = re.sub("<[^>]+>","",title).replace("&amp;","&")
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{plain} · Shah Apiaries™</title>
<meta name="description" content="{plain} for Shah Apiaries™, raw honey from Kashmir.">
<link rel="canonical" href="https://shahapiaries.in/{slug}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital@1&family=Nunito+Sans:opsz,wght@6..12,300;6..12,600&display=swap">
<link rel="stylesheet" href="/legal.css">
</head>
<body>
<div class="bar">Raw honey from Kashmir</div>
<header class="top"><div class="in">
  <a class="brand" href="/" aria-label="Shah Apiaries home"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="{LEAF}" fill="#FBE5A0"/><path d="{COMB}" fill="#F2C230" stroke="#fff" stroke-width="2"/></svg><b>Shah Apiaries<sup class="tm">™</sup></b></a>
  <a class="back" href="/">← Back to shop</a>
</div></header>
<main>
  <p class="eyebrow">{eyebrow}</p>
  <h1>{title}</h1>
  <p class="meta">Last updated {UPDATED}</p>
  {intro}
  {f'<div class="summary">{summary}</div>' if summary else ""}
  {f'<nav class="toc" aria-label="On this page"><b>On this page</b><ol>{toc}</ol></nav>' if len(sections)>3 else ""}
  {body}
</main>
<footer><div class="in">{nav}<p class="legal">© <span data-year>2026</span> {BIZ}. All rights reserved. FSSAI Reg. No. {FSSAI}.</p></div></footer>
<script src="/legal.js" defer></script>
</body>
</html>
'''
    assert "—" not in doc, slug
    open(os.path.join(OUT, slug + ".html"), "w").write(doc)

CONTACT_CARD = f'''<div class="card"><p><b>{BIZ}</b><br>Proprietor and Grievance Officer: {OWNER}<br>{ADDR}<br>Email: <a href="mailto:{EMAIL}">{EMAIL}</a></p></div>'''

# ---------------- PRIVACY ----------------
page("privacy", "Privacy policy", "Your data",
f'''<p>This policy explains what personal data {BIZ} ("we", "us") collects when you visit shahapiaries.in or buy from us, why we collect it, who we share it with, how long we keep it, and the rights you have. It is written to meet the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000 and its rules, and the Consumer Protection (E-Commerce) Rules, 2020.</p>''',
'''<p><b>In short:</b></p><ul>
<li>We collect only what we need to deliver your honey and support your order.</li>
<li>We never see or store your card, UPI PIN or bank details. Razorpay handles payments.</li>
<li>We do not sell your data, rent it, or use it for advertising profiles.</li>
<li>We use no advertising or tracking cookies.</li>
<li>You can ask us to see, correct or delete your data at any time.</li></ul>''',
[
("who","1. Who we are", f'''<p>{BIZ} is a sole proprietorship owned by {OWNER}, packing raw honey at {ADDR}. For the purposes of the DPDP Act we are the "Data Fiduciary" for the personal data described here.</p>{CONTACT_CARD}'''),
("collect","2. Data we collect", f'''<h3>Data you give us</h3>
<div class="scroll"><table><tr><th>When</th><th>What</th></tr>
<tr><td>Placing an order</td><td>Name, mobile number, email (optional), delivery address, city, PIN code, gift note (optional), items ordered, coupon code, payment method</td></tr>
<tr><td>Tracking an order</td><td>Order number and mobile number</td></tr>
<tr><td>Harvest or back-in-stock alerts</td><td>Email address or WhatsApp number</td></tr>
<tr><td>Writing a review</td><td>Name or initials, city, rating, review text</td></tr>
<tr><td>Gift or bulk enquiries, messages to us</td><td>Name, phone, occasion, quantities, dates, anything you write to us on WhatsApp, email or Instagram</td></tr></table></div>
<h3>Data created when you use the site</h3><ul>
<li><b>Order records:</b> order number, amounts, discounts, status updates, courier and tracking number, and notes we add while handling your order.</li>
<li><b>Payment references:</b> Razorpay order and payment IDs and whether a payment succeeded. We do not receive card numbers, CVV, UPI PIN, net-banking passwords or bank account numbers.</li>
<li><b>Security data:</b> your IP address, only when a wrong discount code or wrong admin login is entered, to block guessing. These records are deleted automatically within 24 hours.</li>
<li><b>Server logs:</b> our host, Cloudflare, briefly processes technical data such as IP address, browser type and pages requested to deliver the site and protect it from attacks.</li></ul>
<h3>Data stored only on your own device</h3>
<p>Your cart, wishlist, saved delivery address, recent orders list and applied coupon are kept in your browser's local storage so they are there next time. This data stays on your device. You can clear it at any time from your browser settings.</p>
<h3>Data we do not collect</h3>
<p>We do not knowingly collect sensitive data such as health, financial account, biometric or government ID details, and we ask you not to send them to us.</p>'''),
("why","3. Why we use it", '''<div class="scroll"><table><tr><th>Purpose</th><th>Data used</th><th>Legal basis</th></tr>
<tr><td>Packing, shipping and delivering your order, collecting cash on delivery</td><td>Name, phone, address, items, payment status</td><td>Your consent when you place the order, and performance of the sale</td></tr>
<tr><td>Order updates, delivery coordination and payment links by WhatsApp, SMS, call or email</td><td>Name, phone, email, order details</td><td>Consent</td></tr>
<tr><td>Letting you track your order</td><td>Order number, phone</td><td>Consent</td></tr>
<tr><td>Applying first-order and friends &amp; family discounts, preventing misuse</td><td>Phone, coupon code, order history</td><td>Consent and legitimate use</td></tr>
<tr><td>Refunds, replacements and complaints</td><td>Order and payment details, photos or videos you send</td><td>Consent and legal obligation</td></tr>
<tr><td>Tax, accounting and legal records</td><td>Invoices and order records</td><td>Legal obligation (GST, Income Tax and other laws)</td></tr>
<tr><td>Security, fraud prevention and keeping the site working</td><td>IP address, technical data</td><td>Legitimate use</td></tr>
<tr><td>Harvest news and back-in-stock alerts</td><td>Email or WhatsApp number</td><td>Consent, which you can withdraw at any time</td></tr></table></div>
<p>We will not use your data for any new purpose without telling you and, where required, asking for your consent again.</p>'''),
("share","4. Who we share it with", f'''<p>We share only what each party needs to do its job, and never sell your data.</p><ul>
<li><b>Razorpay Software Pvt. Ltd.</b> processes online and advance payments under its own privacy policy and RBI rules.</li>
<li><b>Courier and postal partners</b> (for example India Post, Delhivery, DTDC or others we use) receive your name, phone and address to deliver your parcel.</li>
<li><b>Cloudflare, Inc.</b> hosts the website and stores order records in its database service. Its servers may be located outside India.</li>
<li><b>Google</b> serves the website's fonts, which means your browser connects to Google's servers.</li>
<li><b>Meta (WhatsApp and Instagram)</b> carries any messages you exchange with us on those apps.</li>
<li><b>Government and legal authorities</b> when the law requires it, for example tax authorities, courts or police with a valid order.</li>
<li><b>A buyer or successor</b> if the business is ever sold or transferred, under the same protections described here.</li></ul>
<p>These partners must keep your data secure and use it only for the services they provide to us.</p>'''),
("abroad","5. Transfers outside India", '''<p>Some of our service providers, such as Cloudflare and Google, may process data on servers outside India. We use them only in ways permitted under the DPDP Act, 2023 and will follow any restrictions the Government of India notifies on transfers to particular countries.</p>'''),
("keep","6. How long we keep it", '''<div class="scroll"><table><tr><th>Data</th><th>Kept for</th></tr>
<tr><td>Orders, invoices and payment references</td><td>8 years from the end of the financial year of the order, as required by tax and accounting laws</td></tr>
<tr><td>Cancelled orders that we delete</td><td>Removed from our order system when deleted</td></tr>
<tr><td>Failed code or login attempts (IP address)</td><td>Up to 24 hours</td></tr>
<tr><td>Alert sign-ups</td><td>Until you unsubscribe or ask us to delete them</td></tr>
<tr><td>Messages and complaint records</td><td>Up to 3 years after the matter is closed</td></tr></table></div>
<p>When data is no longer needed, we delete it or make it anonymous.</p>'''),
("security","7. How we protect it", '''<ul>
<li>The whole site runs over encrypted HTTPS.</li>
<li>Payments are handled entirely on Razorpay's PCI-DSS compliant checkout.</li>
<li>Only the owner and one family member can open the order dashboard, with hashed passwords, secure session cookies and automatic blocking after repeated wrong logins.</li>
<li>Order tracking needs both the order number and the mobile number used for the order.</li></ul>
<p>No system is perfectly secure. If a personal data breach happens, we will inform affected customers and the Data Protection Board of India as the law requires.</p>'''),
("rights","8. Your rights", '''<p>Under the DPDP Act, 2023 you can:</p><ul>
<li><b>Access:</b> ask for a summary of the personal data we hold about you and who we shared it with.</li>
<li><b>Correct or update</b> inaccurate or incomplete data, such as a changed address.</li>
<li><b>Erase:</b> ask us to delete your data, unless we must keep it by law, for example invoices.</li>
<li><b>Withdraw consent</b> at any time. This will not affect what was done before, and we may not be able to complete an order that is still in progress.</li>
<li><b>Nominate</b> someone to exercise these rights if you die or become unable to do so.</li>
<li><b>Grievance redressal:</b> complain to our Grievance Officer, and if you are not satisfied, to the Data Protection Board of India.</li></ul>
<p>Email us from the address or WhatsApp number linked to your order so we can confirm it is you. We reply within 7 days and act on requests within 30 days.</p>'''),
("cookies","9. Cookies and local storage", '''<ul>
<li>The shop sets <b>no advertising, analytics or tracking cookies</b>.</li>
<li>Your browser's local storage keeps your cart, wishlist, saved address and recent orders, as described in section 2.</li>
<li>Our order dashboard uses one essential security cookie for staff logins only.</li>
<li>Razorpay may set its own cookies inside the payment window to process and secure your payment.</li></ul>'''),
("children","10. Children", '''<p>Our shop is meant for adults. If you are under 18, please order with the involvement of a parent or guardian. We do not knowingly collect data from children without verifiable parental consent, track children, or target them with advertising. If you believe a child has given us data, contact us and we will delete it.</p>'''),
("marketing","11. Messages from us", '''<p>We send order-related messages that you need, such as confirmations, payment links and delivery updates. We send harvest news or offers only if you signed up for them. Reply STOP on WhatsApp or email us to stop them at any time.</p>'''),
("links","12. Other websites", '''<p>Links to Instagram, WhatsApp, Razorpay, couriers or other sites are governed by their own privacy policies. We are not responsible for how they handle your data.</p>'''),
("changes","13. Changes to this policy", '''<p>We may update this policy as our shop or the law changes. The date at the top shows the latest version. If a change significantly affects how we use your data, we will tell you on the site or by message before it applies.</p>'''),
("grievance","14. Grievance Officer", f'''<p>For any question, request or complaint about your personal data, contact:</p>{CONTACT_CARD}<p>We acknowledge complaints within 48 hours and resolve them within 30 days.</p>'''),
])

# ---------------- TERMS ----------------
page("terms", "Terms &amp; conditions", "The fine print",
f'''<p>These terms apply when you use shahapiaries.in or buy from {BIZ}. By using the site or placing an order, you agree to them, along with our <a href="/privacy">Privacy policy</a>, <a href="/refund-policy">Refunds &amp; cancellations</a> and <a href="/shipping-policy">Shipping policy</a>, which form part of these terms. Please read them before ordering.</p>''',
'''<p><b>In short:</b></p><ul>
<li>Prices are in rupees and include all taxes. Shipping and COD fees are shown before you pay.</li>
<li>Cash on delivery needs a part payment online first.</li>
<li>Discount codes are one per order and cannot be exchanged for cash.</li>
<li>Honey is a natural food: colour, taste and texture vary, and crystallisation is normal.</li>
<li>Never give honey to babies under 12 months.</li></ul>''',
[
("seller","1. About us", f'''<p>The seller is {BIZ}, a sole proprietorship of {OWNER}, at {ADDR}. FSSAI Reg. No. {FSSAI}. "Shah Apiaries" and the chinar-and-honeycomb logo are trademarks of the proprietor.</p>{CONTACT_CARD}'''),
("eligibility","2. Who can order", '''<ul>
<li>You must be 18 or older and able to enter a binding contract under Indian law, or order with a parent or guardian's consent.</li>
<li>We currently deliver within India only.</li>
<li>Give true, complete details. You are responsible for orders placed with your mobile number and for keeping your order number private.</li></ul>'''),
("products","3. Our products", '''<ul>
<li>Our honey is raw: cold strained through cloth and not heated, pasteurised or blended. Colour, aroma, taste, thickness and crystallisation vary naturally between harvests, batches and even jars. These differences are not defects.</li>
<li>Raw honey may crystallise or separate and may contain tiny specks of pollen or wax. This is natural and safe.</li>
<li>Photos and jar illustrations on the site are for reference. The actual jar, label and colour may differ slightly.</li>
<li>Net quantity, MRP, unit sale price, packer details, FSSAI number and other declarations are shown on each product page and on the label. If the website and the jar label ever differ, the jar label applies.</li>
<li>Jar numbers (for example 233/500) and batch codes identify where your honey came from. They do not mean any particular jar number is guaranteed in an order.</li>
<li>Lab reports shown for a batch describe the sample tested for that batch. Results for an individual jar can vary within natural limits.</li>
<li>Gift boxes, tasting sets and custom gift orders may use packaging that differs from the photos, depending on availability.</li></ul>'''),
("health","4. Health and safety", '''<ul>
<li><b>Do not give honey to infants under 12 months</b>, because of the risk of infant botulism.</li>
<li>Honey contains natural pollen and bee products. If you are allergic to pollen, bee stings or bee products, consult a doctor before eating it.</li>
<li>Honey is a sugar. People with diabetes or on medical diets should follow their doctor's advice.</li>
<li>Anything on this site about the uses or traditions of honey is general information, not medical advice, and our products are not intended to diagnose, treat, cure or prevent any disease.</li>
<li>Store jars closed, at room temperature, away from sunlight and moisture, and use a dry spoon. Use before the best before date on the label.</li></ul>'''),
("prices","5. Prices", '''<ul>
<li>All prices are in Indian Rupees (₹) and <b>include all taxes</b>, including GST where applicable. The price on a product is never more than the MRP on its label.</li>
<li>Shipping charges, the COD fee and any discount are shown in your cart and at checkout before you confirm.</li>
<li>Prices, offers and stock can change at any time without notice. The price that applies is the one shown when you place the order.</li>
<li>If a product is listed at an obviously wrong price or with wrong details because of a typing or technical error, we may cancel the order and refund anything paid in full, even after confirmation.</li></ul>'''),
("orders","6. Placing and accepting orders", '''<ul>
<li>Your order is an offer to buy. A contract is formed when we confirm your order and, for prepaid or advance orders, receive the payment.</li>
<li>We may refuse or cancel any order, in full or in part, for reasons such as stock running out, a wrong price, an address we cannot deliver to, failed payment, suspected fraud or misuse of offers, or reasonable concern about unusual quantities. If we cancel, we refund everything you paid for the cancelled part.</li>
<li>Bulk, wedding and corporate gift orders are quoted separately. The quote, including its advance and delivery date, forms part of that order's terms.</li></ul>'''),
("payment","7. Payment", f'''<h3>Online payment</h3><p>UPI, cards, net banking and wallets are processed by Razorpay. Payment is due in full when you order. Your order is confirmed only after Razorpay confirms the payment.</p>
<h3>Cash on delivery (COD)</h3><ul>
<li>COD orders require an <b>advance paid online</b> when ordering: {ADV} of the order total, or {ADV_JK} for delivery addresses in Jammu &amp; Kashmir (PIN codes starting 180 to 193). The balance is paid in cash, or by UPI if the courier offers it, at delivery.</li>
<li>A COD fee of {COD_FEE} is added to COD orders and shown at checkout.</li>
<li>A COD order is confirmed only after the advance is received. Unpaid COD orders may be cancelled.</li>
<li>If you refuse delivery or cannot be reached after the courier's attempts, the order returns to us. We then refund the advance after deducting the actual shipping charges both ways and the COD fee. We may decline future COD orders from that mobile number.</li></ul>
<h3>Payment links</h3><p>When we send a payment link on WhatsApp, the order is confirmed once the link is paid. Links are sent only from our official number, and we will never ask for your OTP, PIN or card details.</p>'''),
("offers","8. Discounts and offers", f'''<ul>
<li><b>First-order code ({CCODE}):</b> {CPCT} off your first order, once per mobile number.</li>
<li><b>Buy {BULKN} or more:</b> {BULKP} off when your order has {BULKN} or more items.</li>
<li><b>Friends &amp; family codes (HIVE20 and FAMILY20):</b> {PPCT} off one order. Each code is personal to the person we gave it to, works only once and cannot be sold. A code is used up when an order is placed with it. If that order is cancelled, the code becomes usable again.</li>
<li>Only one saving applies per order: the largest one. Offers cannot be combined, exchanged for cash, applied to past orders or transferred.</li>
<li>If an order is partly refunded, the discount is adjusted in proportion.</li>
<li>We may change or end any offer, and cancel orders that misuse offers, for example through multiple accounts or numbers.</li></ul>'''),
("monthly","9. Monthly orders (subscribe &amp; save)", f'''<ul>
<li>Choosing "Every month" gives {SUBP} off that honey. It is not an automatic charge: we contact you on WhatsApp before each monthly delivery to confirm it and collect payment.</li>
<li>You can skip a month, change the honey or stop at any time by telling us before that month's payment.</li>
<li>Prices for later months follow the price at the time of each delivery, with the same monthly discount. If a honey is sold out, we will offer a replacement or skip that month.</li></ul>'''),
("delivery","10. Delivery, refunds and cancellations", '''<p>Delivery is covered in our <a href="/shipping-policy">Shipping policy</a>, and refunds, replacements and cancellations in our <a href="/refund-policy">Refunds &amp; cancellations</a> policy. Risk in the goods passes to you on delivery, and ownership passes once the order is fully paid.</p>'''),
("reviews","11. Reviews and content you send", '''<ul>
<li>Reviews must be honest, about your own experience, and must not be abusive, misleading, unlawful or promotional. We do not pay for reviews or edit their meaning.</li>
<li>We may refuse or remove reviews that break these rules.</li>
<li>By sending us a review, photo or video, you allow us to show it on our website and social media, with your first name or initials and city, free of charge. Tell us if you would like it removed.</li></ul>'''),
("use","12. Using the website", '''<p>You must not:</p><ul>
<li>Use the site for any unlawful, fraudulent or harmful purpose.</li>
<li>Try to guess discount codes, access other customers' orders, or get into the admin area.</li>
<li>Interfere with the site's security or operation, for example by hacking, scraping, overloading it or uploading malicious code.</li>
<li>Copy, resell or reuse our content or products' branding without written permission.</li></ul>
<p>We may block access for anyone who breaks these rules.</p>'''),
("ip","13. Intellectual property", f'''<p>"Shah Apiaries", our logo, label designs, jar numbering design, website, text, illustrations and photos belong to {OWNER} / {BIZ} and are protected by Indian trademark and copyright law. You may share links to our pages, but you may not use our name or branding in a way that suggests we endorse you, or resell our honey in repackaged form under our name.</p>'''),
("liability","14. Limitation of liability", '''<ul>
<li>We are responsible for supplying honey that matches its description and meets FSSAI standards, and for refunds or replacements under our policies.</li>
<li>To the extent the law allows, our total liability for any order is limited to the amount you paid for it. We are not liable for indirect or consequential losses, such as loss of profit or business, or for problems caused by misuse, wrong storage, or ignoring the health and safety notes above.</li>
<li>Nothing in these terms limits any right you have under the Consumer Protection Act, 2019 or any liability that cannot be limited by law.</li></ul>'''),
("indemnity","15. Your responsibility", '''<p>If you break these terms or the law while using our site, for example through fraud or misuse of offers, you agree to cover the reasonable losses and costs this causes us.</p>'''),
("force","16. Events beyond our control", '''<p>We are not responsible for delays or failure to perform caused by events beyond our reasonable control. These include weather, snowfall, landslides and road closures, floods, epidemics, strikes, curfews, internet or communication shutdowns, government orders, courier or payment network failures, and similar events. We will keep you informed and you may cancel affected undelivered orders for a full refund.</p>'''),
("law","17. Governing law and disputes", '''<p>These terms are governed by the laws of India. Please contact us first, since most problems can be solved quickly. If a dispute remains, the courts at Srinagar, Jammu &amp; Kashmir have jurisdiction, without affecting your right to approach a Consumer Commission or the National Consumer Helpline (1915 or consumerhelpline.gov.in).</p>'''),
("general","18. General", '''<ul>
<li>We may update these terms from time to time. The version on the site when you place an order applies to that order.</li>
<li>If any part of these terms is found invalid, the rest still applies.</li>
<li>If we do not enforce a term straight away, we can still enforce it later.</li>
<li>These terms, together with the policies linked above, are the whole agreement between you and us about your order.</li></ul>'''),
("grievance","19. Contact and Grievance Officer", f'''<p>Under the Consumer Protection (E-Commerce) Rules, 2020, our Grievance Officer is:</p>{CONTACT_CARD}<p>We acknowledge complaints within 48 hours and resolve them within one month.</p>'''),
])

# ---------------- REFUNDS ----------------
page("refund-policy", "Refunds &amp; cancellations", "If something goes wrong",
'''<p>Honey is a food product, so for safety we cannot take back opened or used jars. But if anything is wrong with your order, we will make it right.</p>''', "",
[
("cancel","1. Cancelling an order", '''<ul>
<li><b>Before dispatch:</b> cancel any time by WhatsApp or email with your order number. You get a full refund of everything paid, including any COD advance.</li>
<li><b>After dispatch:</b> the order can no longer be cancelled. You may refuse delivery, in which case the refund rules for refused orders below apply.</li>
<li><b>Custom, bulk and gift orders</b> with personalised tags or notes can be cancelled for a full refund only before we start preparing them. After that, the advance covers materials already used.</li>
<li>We may cancel an order ourselves, as described in our terms. If we do, you get a full refund.</li></ul>'''),
("damaged","2. Damaged, leaking, wrong or missing items", '''<p><b>An unboxing video is mandatory for these claims.</b> Please record one every time you open a parcel from us:</p><ul>
<li>Start recording <b>before the sealed parcel is opened</b>, with the shipping label and order number visible.</li>
<li>Keep it as one continuous, unedited video until every jar is out and the problem is clearly shown.</li></ul>
<p>Then:</p><ul>
<li>Send the video with your order number on WhatsApp or email <b>within 24 hours of delivery</b>. Claims sent later, or without an unboxing video, cannot be accepted.</li>
<li>If a jar arrived broken or leaking, or you received the wrong honey or size, we will send a free replacement or give a full refund for that item, whichever you prefer.</li>
<li>If something is missing from your order, we will send it or refund it.</li>
<li>You do not need to return a broken jar. For a wrong item, we may arrange a free pickup or ask you to keep it.</li></ul>'''),
("quality","3. Quality concerns", '''<p>If you believe your honey is not as described, tell us within 7 days of delivery with your batch code and jar number. We will check it against that batch's lab report and, if there is a genuine problem, replace it or refund it.</p>
<p>The following are natural features of raw honey and are not defects: crystallisation or setting, separation into layers, foam on top, tiny specks of pollen or wax, and differences in colour or taste from the photos or from a previous batch.</p>'''),
("not","4. What we cannot refund", '''<ul>
<li>Opened or partly used jars, unless the problem existed when it was delivered.</li>
<li>Change of mind after dispatch.</li>
<li>Damage, leakage, wrong item or missing item claims reported more than 24 hours after delivery, or without an unboxing video.</li>
<li>Quality concerns reported more than 7 days after delivery.</li>
<li>Damage caused after delivery, for example from wrong storage.</li></ul>'''),
("refused","5. Refused or undelivered orders", f'''<p>If a parcel comes back to us because delivery was refused, the address was wrong or incomplete, or you could not be reached after the courier's attempts:</p><ul>
<li><b>Prepaid orders:</b> we refund the amount paid minus the actual shipping charges both ways, or reship it if you pay the shipping again.</li>
<li><b>COD orders:</b> we refund the advance minus the actual shipping charges both ways and the COD fee of {COD_FEE}.</li></ul>'''),
("how","6. How and when refunds are paid", '''<ul>
<li>Approved refunds are started within 2 working days.</li>
<li>Online and advance payments are refunded to the <b>original payment method</b> through Razorpay. Banks usually take 5 to 7 working days to show it.</li>
<li>Cash paid on delivery is refunded by UPI or bank transfer to an account you give us.</li>
<li>Any discount or offer on the order is adjusted in proportion to the refunded items.</li>
<li>We will share the refund reference number so you can follow it up with your bank.</li></ul>'''),
("contact","7. How to reach us", f'''{CONTACT_CARD}<p>We acknowledge complaints within 48 hours and resolve them within one month.</p>'''),
])

# ---------------- SHIPPING ----------------
page("shipping-policy", "Shipping policy", "Getting honey to you",
f'''<p>Every order is packed by hand in Srinagar and sent with a tracked courier or India Post.</p>''', "",
[
("where","1. Where we deliver", '''<p>We deliver to most PIN codes in India. We do not ship outside India yet. If a courier cannot service your PIN code, we will contact you to find another option or cancel with a full refund.</p>'''),
("time","2. Dispatch and delivery times", '''<div class="scroll"><table><tr><th>Step</th><th>Usual time</th></tr>
<tr><td>Packing and dispatch</td><td>1 to 2 working days after the order is confirmed (after payment or the COD advance)</td></tr>
<tr><td>Jammu &amp; Kashmir</td><td>2 to 4 days after dispatch</td></tr>
<tr><td>Rest of India</td><td>4 to 8 days after dispatch</td></tr>
<tr><td>North-East, Ladakh, islands and remote areas</td><td>6 to 10 days after dispatch</td></tr></table></div>
<p>These are estimates, not guarantees. Weather, snowfall, road closures, holidays, curfews, internet shutdowns and courier delays can add time, especially in winter. Working days are Monday to Saturday, excluding public holidays.</p>'''),
("charges","3. Shipping charges", f'''<ul>
<li><b>Free shipping</b> on orders of {FREE} and above, after discounts.</li>
<li>Below that, a flat {SHIP} per order.</li>
<li>Cash on delivery adds a COD fee of {COD_FEE} and needs an online advance of {ADV} ({ADV_JK} in Jammu &amp; Kashmir). See our <a href="/terms#payment">terms</a>.</li>
<li>All charges are shown at checkout before you pay. There are no hidden fees.</li></ul>'''),
("tracking","4. Tracking", '''<p>Once your parcel ships, we send the courier name and tracking number on WhatsApp. You can also see it under <b>My orders</b> on our website using your order number and mobile number.</p>'''),
("address","5. Address and delivery", '''<ul>
<li>Please give a full address with landmark, PIN code and a reachable mobile number. We are not responsible for delays or loss caused by an incomplete or wrong address.</li>
<li>To change the address, message us before dispatch.</li>
<li>Check the parcel at delivery. If the box is visibly damaged or wet, note it with the courier if you can.</li>
<li>Always record an unboxing video when you open the parcel. It is required for any damage, leakage, wrong or missing item claim, which must reach us within 24 hours of delivery.</li></ul>'''),
("problems","6. Delays, lost and damaged parcels", '''<ul>
<li>If tracking has not moved for 5 working days, tell us and we will chase the courier.</li>
<li>If a parcel is confirmed lost in transit, we will resend it or refund you in full.</li>
<li>Broken or leaking jars are replaced or refunded under our <a href="/refund-policy">Refunds &amp; cancellations</a> policy.</li></ul>'''),
("contact","7. Questions", CONTACT_CARD),
])

# ---------------- CONTACT ----------------
page("contact", "Contact &amp; grievances", "Talk to us",
f'''<p>We are a small family business and read every message ourselves.</p>''', "",
[
("details","Business details", f'''<div class="card"><p><b>{BIZ}</b><br>Sole proprietorship of {OWNER}<br>{ADDR}<br>Email: <a href="mailto:{EMAIL}">{EMAIL}</a><br>Instagram: <a href="https://www.instagram.com/shahapiaries/" rel="noopener" target="_blank">@shahapiaries</a><br>FSSAI Reg. No. {FSSAI}</p></div>
<p>For order questions, please include your order number (it starts with SA-).</p>'''),
("grievance","Grievance Officer", f'''<p>As required by the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data Protection Act, 2023:</p>
<div class="card"><p><b>{OWNER}</b>, Grievance Officer<br>{BIZ}, {ADDR}<br>Email: <a href="mailto:{EMAIL}">{EMAIL}</a></p></div>
<p>We acknowledge every complaint within 48 hours and resolve it within one month. If you are not satisfied, you can contact the National Consumer Helpline on 1915 or at <a href="https://consumerhelpline.gov.in" rel="noopener" target="_blank">consumerhelpline.gov.in</a>.</p>'''),
("policies","Our policies", '''<ul><li><a href="/terms">Terms &amp; conditions</a></li><li><a href="/privacy">Privacy policy</a></li><li><a href="/refund-policy">Refunds &amp; cancellations</a></li><li><a href="/shipping-policy">Shipping policy</a></li></ul>'''),
])
print("built")
