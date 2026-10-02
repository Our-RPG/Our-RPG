/* koha.js — the transparency page's data (audit §9), plus the our-rpg.com/koha
 * donation flow: a direct Stripe Checkout Session, one-time or monthly. No
 * webhook, no payments table — koha is a no-strings gift with nothing to
 * fulfill server-side; Stripe's own dashboard is the record of what came in,
 * and the real monthly cost figure above stays hand-entered either way. */

import { json, now, err, readJson, rateLimit, clientIp } from "./util.js";

export async function transparency(req, env) {
  const [costs, players] = await Promise.all([
    env.DB.prepare("SELECT month, usd_cents, note FROM koha_costs ORDER BY month DESC LIMIT 24").all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?").bind(now() - 30 * 864e5).first(),
  ]);
  const history = costs.results;
  return json({
    ok: true,
    current: history[0] || null,      // newest entered month
    history,
    players30d: players?.n || 0,
    note: "Koha is welcome and never expected. Nothing in Our RPG is metered, gated, or worse without it.",
  }, 200, { "cache-control": "public, max-age=3600" });
}

// Stripe wants nested fields as bracket-notation form keys, not JSON.
function stripeForm(obj) {
  const params = new URLSearchParams();
  const add = (key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val))
      for (const [k, v] of Object.entries(val)) add(`${key}[${k}]`, v);
    else if (Array.isArray(val)) val.forEach((v, i) => add(`${key}[${i}]`, v));
    else params.append(key, String(val));
  };
  for (const [k, v] of Object.entries(obj)) add(k, v);
  return params;
}

/* POST /api/koha/checkout — {amount: 1-500 (USD), interval: "once"|"month"}
 * Creates a Stripe Checkout Session and hands back its hosted URL; the
 * client just redirects the browser there. No auth required (same as
 * Ko-fi, donations work logged out too). */
export async function checkout(req, env) {
  if (!env.STRIPE_SECRET_KEY) return err("Koha isn't configured on this server yet.", 503);
  const ip = clientIp(req);
  if (!await rateLimit(env, `koha-checkout:${ip}`, 10, 3600))
    return err("Too many attempts — try later.", 429);
  const b = await readJson(req);
  const amount = Number(b && b.amount);
  const interval = b && b.interval === "month" ? "month" : "once";
  if (!Number.isFinite(amount) || amount < 1 || amount > 500)
    return err("Need {amount: 1-500, interval: 'once'|'month'}.");
  const origin = req.headers.get("origin") || "https://our-rpg.com";
  const priceData = {
    currency: "usd",
    unit_amount: Math.round(amount * 100),
    product_data: { name: "Koha — Our RPG" },
    ...(interval === "month" ? { recurring: { interval: "month" } } : {}),
  };
  const form = stripeForm({
    mode: interval === "month" ? "subscription" : "payment",
    line_items: [{ price_data: priceData, quantity: 1 }],
    success_url: `${origin}/koha?thanks=1`,
    cancel_url: `${origin}/koha`,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const data = await r.json();
  if (!r.ok) return err(data.error?.message || "Stripe error.", 502);
  return json({ ok: true, url: data.url });
}
