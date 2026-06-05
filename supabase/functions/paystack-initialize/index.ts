import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAYSTACK_BASE = "https://api.paystack.co";

// NGN base prices in NAIRA (we convert to kobo for Paystack)
const TIER_PRICES_NGN: Record<string, { monthly: number; yearly: number }> = {
  basic:    { monthly: 5000,  yearly: 42000 },
  pro:      { monthly: 20000, yearly: 168000 },
  ultimate: { monthly: 50000, yearly: 420000 },
};

const planName = (tier: string, cycle: string) => `astraz_${tier}_${cycle}`;
const planInterval = (cycle: string) => (cycle === "yearly" ? "annually" : "monthly");

async function paystack(path: string, opts: RequestInit = {}) {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function findOrCreatePlan(tier: string, cycle: string, amountKobo: number) {
  const name = planName(tier, cycle);
  // List plans (Paystack returns up to 50 per page by default)
  const list = await paystack(`/plan?perPage=100`);
  if (list.ok && Array.isArray(list.json?.data)) {
    const existing = list.json.data.find((p: any) => p.name === name);
    if (existing) return existing.plan_code as string;
  }
  const created = await paystack(`/plan`, {
    method: "POST",
    body: JSON.stringify({
      name,
      amount: amountKobo,
      interval: planInterval(cycle),
      currency: "NGN",
    }),
  });
  if (!created.ok) throw new Error(`Plan create failed: ${JSON.stringify(created.json)}`);
  return created.json.data.plan_code as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!Deno.env.get("PAYSTACK_SECRET_KEY")) {
      return new Response(JSON.stringify({ error: "Paystack not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tier, cycle, autoRenew, callbackUrl, channel } = body || {};
    if (!["basic", "pro", "ultimate"].includes(tier) || !["monthly", "yearly"].includes(cycle)) {
      return new Response(JSON.stringify({ error: "Invalid tier or cycle" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountNaira = TIER_PRICES_NGN[tier][cycle as "monthly" | "yearly"];
    const amountKobo = amountNaira * 100;

    const payload: any = {
      email: user.email,
      amount: amountKobo,
      currency: "NGN",
      callback_url: callbackUrl,
      channels: channel === "apple_pay"
        ? ["apple_pay"]
        : channel === "bank_transfer"
          ? ["bank_transfer"]
          : channel === "card"
            ? ["card"]
            : undefined,
      metadata: {
        user_id: user.id,
        tier,
        cycle,
        auto_renew: !!autoRenew,
        channel: channel || null,
      },
    };

    if (autoRenew) {
      const planCode = await findOrCreatePlan(tier, cycle, amountKobo);
      payload.plan = planCode;
    }

    const init = await paystack(`/transaction/initialize`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!init.ok) {
      return new Response(JSON.stringify({ error: init.json?.message || "Initialize failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      authorization_url: init.json.data.authorization_url,
      access_code: init.json.data.access_code,
      reference: init.json.data.reference,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
