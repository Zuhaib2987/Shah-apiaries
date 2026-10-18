# Browser test against a running local server: node test/harness.mjs (PORT=8790)
import asyncio, hmac, hashlib, sys, os
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:8790")
SHOTS = sys.argv[1] if len(sys.argv) > 1 else "."
STUB = """
window.Razorpay = class { constructor(o){ this.o = o; this.h = {}; } on(e, f){ this.h[e] = f; }
  open(){ const o = this.o; window.__sign(o.order_id, 'pay_UI1').then(sig => o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_UI1', razorpay_signature: sig })); } };
"""
def sign(order_id, pay_id):
    return hmac.new(b"mocksecret", f"{order_id}|{pay_id}".encode(), hashlib.sha256).hexdigest()

async def fill_checkout(pg, phone):
    await pg.fill('#coName','Aamir Shah'); await pg.fill('#coPhone', phone); await pg.fill('#coAddr','House 4, Lane 2, Rajbagh')
    await pg.fill('#coCity','Srinagar'); await pg.fill('#coPin','190008')

async def main():
    errs = []; ok = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":390,"height":844})
        pg = await ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.route("https://checkout.razorpay.com/v1/checkout.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=STUB))
        await pg.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        await pg.expose_function("__sign", sign)
        await pg.goto(BASE + "/"); await pg.wait_for_function("API.ok === true")
        ok.append("catalog loaded from API")

        # COD order
        await pg.click('#grid [data-add="acacia"]'); await pg.click('[data-szadd]')
        await pg.click('.bag'); await pg.click('#cartFoot [data-checkout]')
        await fill_checkout(pg, "9876500001"); await pg.check('input[name="pay"][value="cod"]')
        await pg.click('#coForm button[type=submit]'); await pg.wait_for_selector('#coBody .tick')
        txt = await pg.inner_text('#coBody'); assert "Order placed" in txt and "Cash on delivery" in txt, txt
        cod_id = (await pg.inner_text('#coBody p.mono')).strip(); ok.append(f"COD order placed {cod_id}")
        await pg.screenshot(path=f"{SHOTS}/ui_cod_done.png")
        await pg.click('#ov-checkout [data-close]')

        # Online order, stubbed Razorpay
        await pg.click('#grid [data-add="sulai"]'); await pg.click('[data-szadd]')
        await pg.click('.bag'); await pg.click('#cartFoot [data-checkout]')
        await fill_checkout(pg, "9876500002")
        lbl = await pg.inner_text('.pay-opts label:has(input[value=online])'); assert "Razorpay" in lbl, lbl
        await pg.click('#coForm button[type=submit]'); await pg.wait_for_selector('#coBody .tick:text("✓")', timeout=8000)
        txt = await pg.inner_text('#coBody'); assert "Paid online" in txt, txt
        ok.append("online order paid through Razorpay flow")
        await pg.click('#ov-checkout [data-close]')

        # My orders shows live status
        await pg.click('.bnav [data-open="orders"]'); await pg.wait_for_timeout(800)
        body = await pg.inner_text('#ordersBody'); assert "Order placed" in body and cod_id in body, body
        ok.append("My orders shows live status")
        await pg.click('#ov-orders [data-close]')

        # Admin: mark COD order shipped
        adm = await ctx.new_page(); adm.on("pageerror", lambda e: errs.append("admin: "+str(e)))
        await adm.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        await adm.goto(BASE + "/admin"); await adm.fill('#lu','zuhaib'); await adm.fill('#lp','wrong-pass'); await adm.click('#loginForm button')
        await adm.wait_for_selector('#loginErr:not([hidden])'); ok.append("admin rejects wrong password")
        await adm.fill('#lp','honey-admin-1'); await adm.click('#loginForm button'); await adm.wait_for_selector('#appView:not([hidden])')
        await adm.wait_for_selector(f'[data-open="{cod_id}"]'); await adm.screenshot(path=f"{SHOTS}/ui_admin_list.png")
        await adm.click(f'[data-open="{cod_id}"]'); await adm.wait_for_selector('[data-act="next"]')
        await adm.click('[data-act="next"]'); await adm.wait_for_timeout(300)   # confirm
        await adm.click('[data-act="next"]'); await adm.wait_for_timeout(300)   # packed
        await adm.fill('#sCourier','India Post'); await adm.fill('#sAwb','EK998877665IN'); await adm.click('#shipForm button')
        await adm.wait_for_selector('.dh .pill.s-shipped'); ok.append("admin moved order to shipped")
        await adm.screenshot(path=f"{SHOTS}/ui_admin_detail.png", full_page=True)

        # Customer tracking on another device via deep link
        ctx2 = await b.new_context(viewport={"width":1280,"height":900}); pg2 = await ctx2.new_page()
        await pg2.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        await pg2.goto(f"{BASE}/#track-{cod_id}"); await pg2.wait_for_selector('#trackForm')
        await pg2.fill('#trPhone','9876500001'); await pg2.click('#trackForm button'); await pg2.wait_for_timeout(800)
        body = await pg2.inner_text('#ordersBody'); assert "Shipped" in body and "EK998877665IN" in body, body
        ok.append("customer tracks shipped order from another device")
        await pg2.screenshot(path=f"{SHOTS}/ui_track.png")
        await b.close()
    for o in ok: print("✓", o)
    print("page errors:", errs)
asyncio.run(main())
