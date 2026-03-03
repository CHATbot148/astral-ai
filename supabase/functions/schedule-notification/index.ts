import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAST_PATH_WINDOW_MS = 20_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Backend not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const { message, scheduledFor, conversationId, type = "reminder" } = await req.json();

    const userEmail = user.email;
    if (!userEmail) throw new Error("User email not found");

    const { data: inserted, error: insertError } = await supabase
      .from("scheduled_notifications")
      .insert({
        user_id: userId,
        message,
        scheduled_for: scheduledFor,
        conversation_id: conversationId,
        type,
        status: "pending",
        email: userEmail,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    const scheduledDate = new Date(scheduledFor);
    const now = new Date();
    const delayMs = scheduledDate.getTime() - now.getTime();

    if (delayMs <= FAST_PATH_WINDOW_MS) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      await deliverReminderNow({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        brevoApiKey: BREVO_API_KEY,
        notificationId: inserted.id,
        userId,
        userEmail,
        message,
        type,
        conversationId,
      });

      return new Response(
        JSON.stringify({ success: true, sent: true, message: "Reminder delivered" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: false,
        scheduledFor,
        message: `Notification scheduled for ${scheduledDate.toLocaleString()}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Schedule notification error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function deliverReminderNow(params: {
  supabase: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceRoleKey: string;
  brevoApiKey: string | undefined;
  notificationId: string;
  userId: string;
  userEmail: string;
  message: string;
  type: string;
  conversationId?: string | null;
}) {
  const {
    supabase,
    supabaseUrl,
    serviceRoleKey,
    brevoApiKey,
    notificationId,
    userId,
    userEmail,
    message,
    type,
    conversationId,
  } = params;

  if (conversationId) {
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: `[REMINDER] 🔔 ${message}`,
    });
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("notification_preference")
    .eq("user_id", userId)
    .single();

  const { data: pushSubs } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  const pref = profileData?.notification_preference || "push_and_email";
  const shouldEmail = pref === "push_and_email" || pref === "email_only";
  const shouldPush = pref === "push_and_email" || pref === "push_only";
  const hasPushSubscription = Boolean(pushSubs && pushSubs.length > 0);
  const effectiveShouldEmail = shouldEmail || (shouldPush && !hasPushSubscription);

  if (shouldPush) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          userId,
          title: "⏰ Reminder from Astraz",
          body: message,
          url: "/",
        }),
      });
    } catch (pushErr) {
      console.error("Push notification error:", pushErr);
    }
  }

  if (brevoApiKey && effectiveShouldEmail) {
    await sendEmail(brevoApiKey, userEmail, message, type);
  }

  await supabase
    .from("scheduled_notifications")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", notificationId);
}

async function sendEmail(apiKey: string, to: string, message: string, type: string) {
  const subject =
    type === "reminder"
      ? "🔔 Reminder from Astraz"
      : type === "checkin"
      ? "👋 Astraz misses you!"
      : "💬 Message from Astraz";

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #00CED1, #9B59B6); padding: 20px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Astraz</h1>
      </div>
      <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; line-height: 1.6; color: #333;">${message}</p>
        <a href="https://astraz.lovable.app" style="display: inline-block; background: linear-gradient(135deg, #00CED1, #9B59B6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px; font-weight: 500;">Open Astraz</a>
      </div>
      <p style="text-align: center; color: #888; font-size: 12px; margin-top: 16px;">
        Sent by Astraz, a product of X-Tech
      </p>
    </div>
  `;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Astraz", email: "xtechnly@gmail.com" },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Brevo email error:", response.status, text);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
