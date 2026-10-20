// Fills live values (fees, percentages) on the policy pages from the shop's price list.
(async () => {
  document.querySelectorAll("[data-year]").forEach(el => el.textContent = new Date().getFullYear());
  try {
    const r = await fetch("/api/catalog", { headers: { accept: "application/json" } });
    if (!r.ok) return;
    const { pricing } = await r.json();
    const fmt = { rupees: n => "₹" + Number(n).toLocaleString("en-IN"), pct: n => n + "%" };
    document.querySelectorAll("[data-cfg]").forEach(el => {
      const [key, kind] = el.dataset.cfg.split(":");
      if (pricing[key] !== undefined) el.textContent = (fmt[kind] || String)(pricing[key]);
    });
  } catch { /* keep the printed defaults */ }
})();
