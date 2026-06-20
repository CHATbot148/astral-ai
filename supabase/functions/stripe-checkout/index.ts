// Stripe BYOK Checkout for Astraz — exists alongside Paystack. Uses STRIPE_SECRET_KEY.
// Actions:
//   { action: "create", tier, cycle, callbackUrl, autoRenew? }
//     -> returns { url } to redirect to Stripe Checkout
//   { action: "verify", sessionId }
//     -> verifies the session, marks subscription active, returns { ok, tier, cycle }
//
// Subscription bookkeeping mirrors the Paystack flow: writes directly to the
// `subscriptions` table in Supabase. We don't add Stripe-specific columns so this
// can ship without a migration; `source: 'stripe'` is recorded in metadata only.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// NGN → USD (Stripe charges in USD by default for international cards).
const NGN_TO_USD = 0.00065;

type Tier = "basic" | "pro" | "ultimate";
type Cycle = "monthly" | "yearly";

const TIER_PRICES_NGN: Record<Tier, { monthly: number; yearly: number }> = {
  basic: { monthly: 2500, yearly: 25000 },
  pro: { monthly: 7500, yearly: 75000 },
  ultimate: { monthly: 15000, yearly: 150000 },
};

const TIER_LABEL: Record<Tier, string> = {
  basic: "Astraz Basic",
  pro: "Astraz Pro",
  ultimate: "Astraz Ultimate",
};

function form(body: Record<string, string>) {
  return new URLSearchParams(body).toString();
}

async function stripeFetch(path: string, key: string, init?: RequestInit) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe ${path} failed (${res.status})`);
  }
  return json;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!STRIPE_KEY) throw new Error("Stripe is not configured yet. Ask the admin to add STRIPE_SECRET_KEY.");
    if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error("Backend is not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Sign in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uc = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userRes } = await uc.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Sign in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "create");

    if (action === "create") {
      const tier = String(body.tier || "pro") as Tier;
      const cycle = String(body.cycle || "monthly") as Cycle;
      const callbackUrl: string = body.callbackUrl || "";
      if (!TIER_PRICES_NGN[tier]) throw new Error("Invalid tier");
      if (cycle !== "monthly" && cycle !== "yearly") throw new Error("Invalid cycle");
      if (!callbackUrl) throw new Error("Missing callbackUrl");

      const ngn = TIER_PRICES_NGN[tier][cycle];
      const usd = Math.max(0.5, Math.round(ngn * NGN_TO_USD * 100) / 100);
      const unitAmount = Math.round(usd * 100); // cents

      const successUrl = `${callbackUrl}${callbackUrl.includes("?") ? "&" : "?"}stripe_session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = callbackUrl;

      const payload: Record<string, string> = {
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(unitAmount),
        "line_items[0][price_data][product_data][name]": `${TIER_LABEL[tier]} (${cycle})`,
        customer_email: user.email || "",
        "metadata[user_id]": user.id,
        "metadata[tier]": tier,
        "metadata[cycle]": cycle,
      };

      const session = await stripeFetch("/checkout/sessions", STRIPE_KEY, {
        method: "POST",
        body: form(payload),
      });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const sessionId = String(body.sessionId || "");
      if (!sessionId) throw new Error("Missing sessionId");
      const session = await stripeFetch(`/checkout/sessions/${sessionId}`, STRIPE_KEY, { method: "GET" });
      if (session.payment_status !== "paid") {
        return new Response(JSON.stringify({ error: `Payment not completed (${session.payment_status})` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tier = (session?.metadata?.tier || "pro") as Tier;
      const cycle = (session?.metadata?.cycle || "monthly") as Cycle;

      const now = new Date();
      const expires = new Date(now);
      if (cycle === "monthly") expires.setMonth(expires.getMonth() + 1);
      else expires.setFullYear(expires.getFullYear() + 1);

      const subData = {
        user_id: user.id,
        tier,
        billing_cycle: cycle,
        status: "active" as const,
        started_at: now.toISOString(),
        expires_at: expires.toISOString(),
        auto_renew: false,
        save_payment_method: false,
        agreed_to_privacy_policy: true,
        privacy_policy_agreed_at: now.toISOString(),
      };

      const { data: existing } = await admin
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        await admin.from("subscriptions").update(subData).eq("user_id", user.id);
      } else {
        await admin.from("subscriptions").insert(subData);
      }

      return new Response(JSON.stringify({ ok: true, tier, cycle }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("stripe-checkout error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
