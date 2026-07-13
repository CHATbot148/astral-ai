import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${SERVICE}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const windowForDay = (days: number) => ({
      min: new Date(now + (days - 0.5) * 24 * 3600 * 1000).toISOString(),
      max: new Date(now + (days + 0.5) * 24 * 3600 * 1000).toISOString(),
    });

    // Renewal-reminder window: expires in ~3d
    let reminders = 0;
    for (const days of [7, 3, 1]) {
      const w = windowForDay(days);
      const { data: dueSoon } = await admin
        .from("subscriptions")
        .select("user_id, tier, billing_cycle, expires_at, auto_renew, status")
        .neq("tier", "free")
        .eq("status", "active")
        .gte("expires_at", w.min)
        .lte("expires_at", w.max);

      for (const s of dueSoon || []) {
        const periodKey = `${days}d-${(s.expires_at || "").slice(0, 10)}`;
        await fetch(`${SUPABASE_URL}/functions/v1/subscription-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({
            user_id: s.user_id, type: "renewal_reminder", period_key: periodKey,
            data: { tier: s.tier, expires_at: s.expires_at, auto_renew: s.auto_renew, days_left: days },
          }),
        });
        reminders++;
      }
    }

    // Any subscription past access_until/expires_at is no longer active. This
    // is the source of truth for coupon and non-renewing plans, so premium
    // access cannot last forever if the client misses a refresh.
    // Any subscription past access_until/expires_at is no longer active. We
    // do NOT filter by status='active' here so that if another codepath (e.g.
    // the paystack webhook) already flipped the row to 'expired', we still
    // send the end-of-plan email. The subscription_email_log dedup guarantees
    // one email per period_key.
    const { data: expired } = await admin
      .from("subscriptions")
      .select("id, user_id, tier, expires_at, access_until, auto_renew, status")
      .neq("tier", "free")
      .in("status", ["active", "expired"])
      .or(`expires_at.lte.${nowIso},access_until.lte.${nowIso}`);

    let expiredSent = 0;
    for (const s of expired || []) {
      const endedAt = s.access_until || s.expires_at || nowIso;
      const periodKey = `${(endedAt || "").slice(0, 10)}`;
      await fetch(`${SUPABASE_URL}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({
          user_id: s.user_id, type: "expired", period_key: periodKey,
          data: { tier: s.tier, expires_at: endedAt },
        }),
      });
      await admin.from("subscriptions").update({
        status: "expired",
        tier: "free",
        auto_renew: false,
        cancelled_at: endedAt,
        access_until: endedAt,
        updated_at: nowIso,
      }).eq("id", s.id);
      expiredSent++;
    }

    return new Response(JSON.stringify({ reminders, expiredSent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[check-subscription-renewals]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
