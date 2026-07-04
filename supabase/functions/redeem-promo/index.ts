import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const { code, action } = await req.json();

    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "Code is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedCode = code.trim().toUpperCase();

    if (action === "validate") {
      const { data: codeData, error: codeError } = await supabase
        .from("promo_codes")
        .select("id, tier, duration_days, current_uses, max_uses, is_active, expires_at")
        .eq("code", normalizedCode)
        .eq("is_active", true)
        .maybeSingle();

      if (codeError || !codeData) {
        return new Response(JSON.stringify({ error: "Invalid promo code" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (codeData.current_uses >= codeData.max_uses) {
        return new Response(JSON.stringify({ error: "This code has already been used" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "This code has expired" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await supabase
        .from("promo_code_redemptions")
        .select("id")
        .eq("user_id", userId)
        .eq("promo_code_id", codeData.id)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ error: "You have already used this code" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        tier: codeData.tier,
        duration_days: codeData.duration_days,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // action === "redeem" (default) — atomic redemption
    const { data, error } = await supabase.rpc("redeem_promo_code", {
      p_code: normalizedCode,
      p_user_id: userId,
    });

    if (error) {
      console.error("RPC error:", error);
      return new Response(JSON.stringify({ error: "Failed to redeem code" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = data?.[0];
    if (!result?.success) {
      return new Response(JSON.stringify({ error: result?.error_message || "Invalid code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const durationDays = Number(result.duration_days || 30);
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const subData = {
      user_id: userId,
      tier: result.tier,
      billing_cycle: "monthly",
      status: "active",
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      access_until: expiresAt.toISOString(),
      cancelled_at: null,
      cancellation_type: null,
      auto_renew: false,
      save_payment_method: false,
      agreed_to_privacy_policy: true,
      privacy_policy_agreed_at: now.toISOString(),
      source: "promo",
    };

    const { error: upsertError } = await supabase
      .from("subscriptions")
      .upsert(subData, { onConflict: "user_id" });
    if (upsertError) {
      console.error("Subscription upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Code redeemed, but subscription activation failed. Contact support." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          user_id: userId,
          type: "payment_success",
          period_key: `promo-${expiresAt.toISOString().slice(0, 10)}`,
          data: { tier: result.tier, cycle: "promo", expires_at: expiresAt.toISOString(), source: "promo" },
        }),
      });
    } catch (emailError) {
      console.error("promo success email failed:", emailError);
    }

    return new Response(JSON.stringify({
      success: true,
      tier: result.tier,
      duration_days: durationDays,
      expires_at: expiresAt.toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("redeem-promo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
