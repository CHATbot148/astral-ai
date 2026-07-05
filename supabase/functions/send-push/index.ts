import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

    const vapidSubject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:xtechnly@gmail.com";
    webpush.setVapidDetails(
      vapidSubject,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

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
        console.log("Attempting push to endpoint:", sub.endpoint.slice(0, 80));
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        sent++;
        console.log("Push sent successfully to:", sub.endpoint.slice(0, 80));
      } catch (err: any) {
        const statusCode = Number(err?.statusCode || err?.status || 0);
        const message = err?.message || String(err);
        const responseBody = typeof err?.body === "string" ? err.body : "";
        console.error("Push send error:", statusCode || "n/a", message, responseBody);

        if (
          [404, 410].includes(statusCode) ||
          /expired|unsubscribed|gone|not\s+found/i.test(message)
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
