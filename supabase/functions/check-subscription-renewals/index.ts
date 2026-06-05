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
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    const now = Date.now();
    const in3dayMin = new Date(now + 2.5 * 24 * 3600 * 1000).toISOString();
    const in3dayMax = new Date(now + 3.5 * 24 * 3600 * 1000).toISOString();

    // Renewal-reminder window: expires in ~3d
    const { data: dueSoon } = await admin
      .from("subscriptions")
      .select("user_id, tier, billing_cycle, expires_at, auto_renew, status")
      .neq("tier", "free")
      .eq("status", "active")
      .gte("expires_at", in3dayMin)
      .lte("expires_at", in3dayMax);

    let reminders = 0;
    for (const s of dueSoon || []) {
      const periodKey = `${(s.expires_at || "").slice(0, 10)}`;
      await fetch(`${SUPABASE_URL}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({
          user_id: s.user_id, type: "renewal_reminder", period_key: periodKey,
          data: { tier: s.tier, expires_at: s.expires_at, auto_renew: s.auto_renew },
        }),
      });
      reminders++;
    }

    // Just-expired (last 24h) and not auto-renewing → send "expired"
    const expiredCutoff = new Date(now - 24 * 3600 * 1000).toISOString();
    const { data: expired } = await admin
      .from("subscriptions")
      .select("user_id, tier, expires_at, auto_renew, status")
      .neq("tier", "free")
      .lte("expires_at", new Date(now).toISOString())
      .gte("expires_at", expiredCutoff);

    let expiredSent = 0;
    for (const s of expired || []) {
      if (s.auto_renew && s.status === "active") continue; // a renewal charge is expected
      const periodKey = `${(s.expires_at || "").slice(0, 10)}`;
      await fetch(`${SUPABASE_URL}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({
          user_id: s.user_id, type: "expired", period_key: periodKey,
          data: { tier: s.tier },
        }),
      });
      expiredSent++;
    }

    return new Response(JSON.stringify({ reminders, expiredSent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[check-subscription-renewals]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
