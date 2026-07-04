import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIER_NAMES: Record<string, string> = {
  basic: "Astraz Basic",
  pro: "Astraz Pro",
  ultimate: "Astraz Ultimate",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
}

function shell(title: string, bodyHtml: string) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;padding:40px 16px">
  <div style="max-width:560px;margin:0 auto;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:18px;padding:36px;border:1px solid rgba(0,212,255,0.2)">
    <div style="text-align:center;margin-bottom:24px"><span style="font-size:30px;font-weight:800;background:linear-gradient(90deg,#00d4ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Astraz</span></div>
    <h1 style="font-size:22px;margin:0 0 16px;text-align:center">${title}</h1>
    ${bodyHtml}
    <div style="text-align:center;margin-top:32px;color:#666;font-size:12px">Astrinique · <a href="https://astraz.online" style="color:#00d4ff;text-decoration:none">astraz.online</a></div>
  </div></body></html>`;
}

function ctaBtn(label: string, href = "https://astraz.online") {
  return `<div style="text-align:center;margin:24px 0"><a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#00d4ff,#a855f7);color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></div>`;
}

const TEMPLATES = {
  payment_success: (d: any) => ({
    subject: `🎉 Welcome to ${TIER_NAMES[d.tier] || "Astraz"}`,
    html: shell("Subscription activated", `
      <p style="color:#cfd2e0;font-size:15px;line-height:1.55">You're now on <strong style="color:#00d4ff">${TIER_NAMES[d.tier] || d.tier}</strong>${d.cycle ? ` (${d.cycle})` : ""}. Astraz just unlocked everything that tier offers.</p>
      ${d.expires_at ? `<p style="color:#9aa1b3;font-size:13px">Active until <strong>${fmtDate(d.expires_at)}</strong>${d.source === "promo" ? " — promo redemption" : ""}.</p>` : ""}
      ${ctaBtn("Open Astraz")}
      <p style="color:#888;font-size:12px;text-align:center">Manage your subscription anytime in Profile → Subscription.</p>
    `),
  }),
  renewal_reminder: (d: any) => ({
    subject: `⏰ Your ${TIER_NAMES[d.tier] || "Astraz"} ${d.auto_renew ? "renews" : "expires"} in ${d.days_left || 3} day${Number(d.days_left || 3) === 1 ? "" : "s"}`,
    html: shell("Renewal coming up", `
      <p style="color:#cfd2e0;font-size:15px;line-height:1.55">Heads up — your <strong>${TIER_NAMES[d.tier] || d.tier}</strong> plan ${d.auto_renew ? "auto-renews" : "expires"} on <strong style="color:#00d4ff">${fmtDate(d.expires_at)}</strong>.</p>
      <p style="color:#9aa1b3;font-size:14px">${d.auto_renew ? "Nothing to do — we'll charge your saved card automatically. Cancel anytime before then in Profile → Subscription." : "Renew now to keep your premium access."}</p>
      ${ctaBtn(d.auto_renew ? "Manage subscription" : "Renew now")}
    `),
  }),
  cancellation: (d: any) => ({
    subject: `Your Astraz subscription was cancelled`,
    html: shell("Subscription cancelled", `
      <p style="color:#cfd2e0;font-size:15px;line-height:1.55">Your <strong>${TIER_NAMES[d.tier] || d.tier}</strong> plan won't renew. ${d.access_until ? `You still have access until <strong>${fmtDate(d.access_until)}</strong>.` : ""}</p>
      <p style="color:#9aa1b3;font-size:14px">Changed your mind? You can resubscribe in one tap from your profile.</p>
      ${ctaBtn("Resubscribe")}
    `),
  }),
  expired: (d: any) => ({
    subject: `Your Astraz ${TIER_NAMES[d.tier] || d.tier} plan has ended`,
    html: shell("Subscription ended", `
      <p style="color:#cfd2e0;font-size:15px;line-height:1.55">Your premium access ended${d.expires_at ? ` on <strong>${fmtDate(d.expires_at)}</strong>` : ""} and your account is back on the Free tier.</p>
      <p style="color:#9aa1b3;font-size:14px">Pick up where you left off — all your chats and memories are exactly as you saved them.</p>
      ${ctaBtn("Upgrade again")}
    `),
  }),
};

async function sendBrevo(apiKey: string, to: string, subject: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Astraz", email: "xtechnly@gmail.com" },
      to: [{ email: to }], subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const BREVO = Deno.env.get("BREVO_API_KEY");
    if (!BREVO) throw new Error("BREVO_API_KEY not configured");

    const { user_id, type, period_key, data } = await req.json();
    if (!user_id || !type || !period_key) throw new Error("user_id, type, period_key required");
    const tpl = (TEMPLATES as any)[type];
    if (!tpl) throw new Error("Unknown email type");

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Dedupe
    const { error: dupErr } = await admin
      .from("subscription_email_log")
      .insert({ user_id, email_type: type, period_key });
    if (dupErr) {
      // already sent for this period
      return new Response(JSON.stringify({ skipped: true, reason: "already_sent" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get email
    const { data: u } = await admin.auth.admin.getUserById(user_id);
    const email = u?.user?.email;
    if (!email) throw new Error("No email for user");

    const { subject, html } = tpl(data || {});
    await sendBrevo(BREVO, email, subject, html);

    return new Response(JSON.stringify({ sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[subscription-email]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
