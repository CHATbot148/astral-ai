import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    return new Response(JSON.stringify({
      success: true,
      tier: result.tier,
      duration_days: result.duration_days,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("redeem-promo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
