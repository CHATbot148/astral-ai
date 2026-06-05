import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference } = await req.json();
    if (!reference) {
      return new Response(JSON.stringify({ error: "reference required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}` },
    });
    const json = await r.json();
    if (!r.ok || json?.data?.status !== "success") {
      return new Response(JSON.stringify({ error: "Verification failed", data: json }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = json.data;
    const meta = data.metadata || {};
    if (meta.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "User mismatch" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tier = meta.tier as string;
    const cycle = meta.cycle as string;
    const autoRenew = !!meta.auto_renew;

    const now = new Date();
    const expires = new Date(now);
    if (cycle === "yearly") expires.setFullYear(expires.getFullYear() + 1);
    else expires.setMonth(expires.getMonth() + 1);

    const authorization = data.authorization || {};
    const customer = data.customer || {};

    const supabase = createClient(supabaseUrl, serviceKey);
    const subData: any = {
      user_id: user.id,
      tier,
      billing_cycle: cycle,
      status: "active",
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
      access_until: expires.toISOString(),
      cancelled_at: null,
      cancellation_type: null,
      auto_renew: autoRenew,
      save_payment_method: true,
      agreed_to_privacy_policy: true,
      privacy_policy_agreed_at: now.toISOString(),
      paystack_customer_code: customer.customer_code || null,
      paystack_authorization_code: authorization.authorization_code || null,
      amount_paid_minor: data.amount,
      currency: data.currency || "NGN",
    };

    const { data: existing } = await supabase
      .from("subscriptions").select("id").eq("user_id", user.id).maybeSingle();

    if (existing) {
      await supabase.from("subscriptions").update(subData).eq("user_id", user.id);
    } else {
      await supabase.from("subscriptions").insert(subData);
    }

    // Fire-and-forget success email
    try {
      await fetch(`${supabaseUrl}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          user_id: user.id, type: "payment_success",
          period_key: `${tier}-${expires.toISOString().slice(0, 10)}`,
          data: { tier, cycle, expires_at: expires.toISOString(), source: "paystack" },
        }),
      });
    } catch (e) { console.error("payment_success email failed:", e); }

    return new Response(JSON.stringify({ success: true, tier, cycle }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
