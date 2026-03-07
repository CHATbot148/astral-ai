import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    webpush.setVapidDetails(
      "mailto:xtechnly@gmail.com",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (subErr) throw subErr;

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
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
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        sent++;
      } catch (err: any) {
        const statusCode = Number(err?.statusCode || err?.status || 0);
        const message = err?.message || String(err);
        console.error("Push send error:", statusCode || "n/a", message);

        if (
          [400, 401, 403, 404, 410].includes(statusCode) ||
          /invalid|expired|unsubscribed|gone|not\s+found/i.test(message)
        ) {
          expiredSubs.push(sub.id);
        }
      }
    }

    if (expiredSubs.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", expiredSubs);
    }

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send push error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
