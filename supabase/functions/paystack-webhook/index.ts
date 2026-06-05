import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") || "";
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  if (sig !== expected) return new Response("Invalid signature", { status: 401 });

  const event = JSON.parse(raw);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const data = event.data || {};
    const meta = data.metadata || data.subscription?.metadata || {};
    const customerCode = data.customer?.customer_code;

    switch (event.event) {
      case "subscription.create": {
        const userId = meta.user_id;
        if (userId) {
          await supabase.from("subscriptions").update({
            paystack_subscription_code: data.subscription_code,
            paystack_email_token: data.email_token,
            auto_renew: true,
          }).eq("user_id", userId);
        }
        break;
      }
      case "charge.success": {
        // Renewal charge — extend period
        if (customerCode) {
          const { data: sub } = await supabase.from("subscriptions")
            .select("*").eq("paystack_customer_code", customerCode).maybeSingle();
          if (sub && sub.status === "active") {
            const newExpiry = new Date();
            if (sub.billing_cycle === "yearly") newExpiry.setFullYear(newExpiry.getFullYear() + 1);
            else newExpiry.setMonth(newExpiry.getMonth() + 1);
            await supabase.from("subscriptions").update({
              expires_at: newExpiry.toISOString(),
              access_until: newExpiry.toISOString(),
              amount_paid_minor: data.amount,
            }).eq("id", sub.id);
          }
        }
        break;
      }
      case "subscription.disable":
      case "subscription.not_renew": {
        if (data.subscription_code) {
          const { data: sub } = await supabase.from("subscriptions")
            .select("user_id, tier, expires_at")
            .eq("paystack_subscription_code", data.subscription_code).maybeSingle();
          await supabase.from("subscriptions").update({ auto_renew: false })
            .eq("paystack_subscription_code", data.subscription_code);
          if (sub?.user_id) {
            try {
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/subscription-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({
                  user_id: sub.user_id, type: "cancellation",
                  period_key: `webhook-${new Date().toISOString().slice(0, 10)}`,
                  data: { tier: sub.tier, access_until: sub.expires_at },
                }),
              });
            } catch (e) { console.error("cancellation email failed:", e); }
          }
        }
        break;
      }
      case "invoice.payment_failed": {
        // Optional: notify user later
        break;
      }
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
  }

  return new Response("ok", { status: 200 });
});
