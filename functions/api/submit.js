// Pages Function: POST /api/submit
// Saves each form submission to D1 (binding: DB) and pings Telegram
// (env: TELEGRAM_BOT_TOKEN secret, TELEGRAM_CHAT_ID variable).

const ALLOWED_ORIGINS = [
  "https://www.malefutures.org",
  "https://malefutures.org",
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const isPreview = origin && /^https:\/\/([a-z0-9-]+\.)?malefutures\.pages\.dev$/.test(origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin) && !isPreview) {
    return json({ error: "Forbidden" }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (body.website) return json({ ok: true }); // honeypot: pretend success

  const kind = body.kind === "updates" ? "updates" : "enquiry";
  const email = clip(body.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email" }, 400);

  const d = {
    kind,
    email,
    name: clip(body.name, 120),
    organisation: clip(body.organisation, 160),
    interest: clip(body.interest, 80),
    message: clip(body.message, 3000),
  };
  if (kind === "enquiry" && (!d.name || !d.message)) return json({ error: "Missing fields" }, 400);

  let saved = false, notified = false;

  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO submissions (kind,name,organisation,email,interest,message,created_at) VALUES (?,?,?,?,?,?,?)"
      ).bind(d.kind, d.name, d.organisation, d.email, d.interest, d.message, new Date().toISOString()).run();
      saved = true;
    } catch (e) { console.error("D1 insert failed", e && e.message); }
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const text = kind === "updates"
      ? `<b>Male Futures Foundation: new update signup</b>\n${esc(d.email)}`
      : `<b>Male Futures Foundation: new enquiry</b>\n` +
        `<b>Name:</b> ${esc(d.name)}\n` +
        (d.organisation ? `<b>Organisation:</b> ${esc(d.organisation)}\n` : "") +
        `<b>Email:</b> ${esc(d.email)}\n` +
        `<b>Interested in:</b> ${esc(d.interest)}\n\n${esc(d.message)}`;
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      notified = r.ok;
      if (!r.ok) console.error("Telegram failed", r.status);
    } catch (e) { console.error("Telegram error", e && e.message); }
  }

  if (!saved && !notified) return json({ error: "Not configured" }, 500);
  return json({ ok: true });
}

export const onRequest = ({ request }) =>
  request.method === "POST" ? undefined : json({ error: "Method not allowed" }, 405);
