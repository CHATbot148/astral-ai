import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANCEL_FEE_NGN_MINOR = 500000; // ₦5,000 in kobo

async function paystack(path: string, opts: RequestInit = {}) {
  return fetch(`https://api.paystack.co${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

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

    const { mode } = await req.json(); // 'end_of_period' | 'immediate_refund'
    if (!["end_of_period", "immediate_refund"].includes(mode)) {
      return new Response(JSON.stringify({ error: "Invalid mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await supabase.from("subscriptions").select("*")
      .eq("user_id", user.id).maybeSingle();
    if (!sub) {
      return new Response(JSON.stringify({ error: "No subscription" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Always disable Paystack auto-renewal so no further charges happen
    if (sub.paystack_subscription_code && sub.paystack_email_token) {
      await paystack(`/subscription/disable`, {
        method: "POST",
        body: JSON.stringify({
          code: sub.paystack_subscription_code,
          token: sub.paystack_email_token,
        }),
      });
    }

    const now = new Date();
    if (mode === "end_of_period") {
      await supabase.from("subscriptions").update({
        cancelled_at: now.toISOString(),
        cancellation_type: "end_of_period",
        auto_renew: false,
      }).eq("user_id", user.id);

      try {
        await fetch(`${supabaseUrl}/functions/v1/subscription-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: user.id, type: "cancellation",
            period_key: `cancel-${now.toISOString().slice(0, 10)}-eop`,
            data: { tier: sub.tier, access_until: sub.expires_at },
          }),
        });
      } catch (e) { console.error("cancellation email failed:", e); }

      return new Response(JSON.stringify({
        success: true, mode, access_until: sub.expires_at, fee_ngn: 0,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // immediate_refund: revoke access now, charge ₦5,000 fee, refund the rest
    let refundResult: any = null;
    if (sub.amount_paid_minor && sub.amount_paid_minor > CANCEL_FEE_NGN_MINOR) {
      const refundAmount = sub.amount_paid_minor - CANCEL_FEE_NGN_MINOR;
      // Find the most recent successful charge by customer
      try {
        const txList = await paystack(`/transaction?customer=${sub.paystack_customer_code}&perPage=10&status=success`);
        const txJson = await txList.json();
        const lastTx = txJson?.data?.[0];
        if (lastTx) {
          const refund = await paystack(`/refund`, {
            method: "POST",
            body: JSON.stringify({
              transaction: lastTx.id,
              amount: refundAmount,
              currency: lastTx.currency || "NGN",
              customer_note: "Subscription cancellation refund (less ₦5,000 fee)",
            }),
          });
          refundResult = await refund.json().catch(() => null);
        }
      } catch (e) {
        console.error("Refund error:", e);
      }
    }

    await supabase.from("subscriptions").update({
      status: "cancelled",
      cancelled_at: now.toISOString(),
      cancellation_type: "immediate_refund",
      auto_renew: false,
      access_until: now.toISOString(),
      expires_at: now.toISOString(),
    }).eq("user_id", user.id);

    // Fire-and-forget cancellation email
    try {
      await fetch(`${supabaseUrl}/functions/v1/subscription-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          user_id: user.id, type: "cancellation",
          period_key: `cancel-${now.toISOString().slice(0, 10)}-${mode}`,
          data: { tier: sub.tier, access_until: mode === "immediate_refund" ? now.toISOString() : sub.expires_at },
        }),
      });
    } catch (e) { console.error("cancellation email failed:", e); }

    return new Response(JSON.stringify({
      success: true, mode, fee_ngn: 5000, refund: refundResult,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
