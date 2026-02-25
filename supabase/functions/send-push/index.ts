import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Web Push crypto helpers using Web Crypto API
async function generatePushPayload(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
) {
  // For Web Push we need the web-push library equivalent
  // Use the web_push Deno module
  const { default: webpush } = await import("https://esm.sh/web-push@3.6.7");
  
  webpush.setVapidDetails(
    "mailto:xtechnly@gmail.com",
    vapidPublicKey,
    vapidPrivateKey
  );

  return webpush.sendNotification(subscription, payload);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("VAPID keys not configured");

    const { userId, title, body, url } = await req.json();
    if (!userId) throw new Error("userId required");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Get all push subscriptions for this user
    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId);

    if (subErr) {
      console.error("Error fetching push subscriptions:", subErr);
      throw subErr;
    }

    if (!subs || subs.length === 0) {
      console.log("No push subscriptions found for user:", userId);
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: title || "Astraz Reminder",
      body: body || "You have a reminder!",
      url: url || "/",
    });

    let sent = 0;
    const expiredSubs: string[] = [];

    for (const sub of subs) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };

        await generatePushPayload(subscription, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        sent++;
        console.log("Push sent to endpoint:", sub.endpoint.slice(0, 50));
      } catch (err: any) {
        console.error("Push send error:", err?.statusCode || err?.message);
        // 410 Gone or 404 = subscription expired
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredSubs.push(sub.id);
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredSubs.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", expiredSubs);
      console.log("Cleaned up expired subscriptions:", expiredSubs.length);
    }

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send push error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
