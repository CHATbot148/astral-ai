import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: reminders, error: fetchErr } = await supabase
      .from("scheduled_notifications")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (fetchErr) {
      console.error("Fetch error:", fetchErr);
      throw fetchErr;
    }

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const reminder of reminders) {
      try {
        const resolvedConversationId = await resolveConversationId(supabase, reminder.user_id, reminder.conversation_id);
        const reminderContent = `[REMINDER] 🔔 ${reminder.message}`;

        const messageInserted = resolvedConversationId
          ? await ensureReminderMessage(supabase, resolvedConversationId, reminderContent)
          : false;

        if (resolvedConversationId && resolvedConversationId !== reminder.conversation_id) {
          await supabase
            .from("scheduled_notifications")
            .update({ conversation_id: resolvedConversationId, updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
        }

        const { data: profileData } = await supabase
          .from("profiles")
          .select("notification_preference")
          .eq("user_id", reminder.user_id)
          .single();

        const { data: pushSubs } = await supabase
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", reminder.user_id)
          .limit(1);

        const pref = profileData?.notification_preference || "push_and_email";
        const shouldEmail = pref === "push_and_email" || pref === "email_only";
        const shouldPush = pref === "push_and_email" || pref === "push_only";
        const hasPushSubscription = Boolean(pushSubs && pushSubs.length > 0);

        const shouldAttemptPush = shouldPush && hasPushSubscription;
        const pushDelivered = shouldAttemptPush
          ? await sendPushNotification(SUPABASE_URL, SERVICE_ROLE_KEY, reminder.user_id, reminder.message)
          : false;

        const fallbackEmail = reminder.email || (await getUserEmail(supabase, reminder.user_id));
        const shouldAttemptEmail = Boolean(BREVO_API_KEY && fallbackEmail) && (shouldEmail || !pushDelivered || !hasPushSubscription);
        const emailDelivered = shouldAttemptEmail
          ? await sendReminderEmail(BREVO_API_KEY!, fallbackEmail!, reminder.message)
          : false;

        const wantsExternalNotification = shouldPush || shouldEmail;
        const externalDelivered = pushDelivered || emailDelivered;
        const delivered = externalDelivered || (!wantsExternalNotification && messageInserted);

        if (delivered) {
          await supabase
            .from("scheduled_notifications")
            .update({ status: "sent", updated_at: new Date().toISOString(), email: fallbackEmail || reminder.email })
            .eq("id", reminder.id);
          processed++;
        } else {
          console.warn("Reminder not delivered yet, will retry:", reminder.id);
          await supabase
            .from("scheduled_notifications")
            .update({ updated_at: new Date().toISOString(), email: fallbackEmail || reminder.email })
            .eq("id", reminder.id);
        }
      } catch (reminderErr) {
        console.error(`Error processing reminder ${reminder.id}:`, reminderErr);
      }
    }

    // Also trigger re-engagement email check (piggyback on cron)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/check-reengagement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({}),
      });
    } catch (reengErr) {
      console.error("Re-engagement check failed (non-blocking):", reengErr);
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Process reminders error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function resolveConversationId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  existingConversationId?: string | null,
): Promise<string | null> {
  if (existingConversationId) return existingConversationId;

  const { data: latestConversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestConversation?.id) return latestConversation.id;

  const { data: createdConversation, error: createError } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "Reminders" })
    .select("id")
    .single();

  if (createError) {
    console.error("Failed to create fallback conversation for reminder:", createError);
    return null;
  }

  return createdConversation.id;
}

async function ensureReminderMessage(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  content: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .eq("content", content)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
    });
    if (insertError) {
      console.error("Reminder message insert error:", insertError);
      return false;
    }
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return true;
}

async function sendPushNotification(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  message: string,
): Promise<boolean> {
  try {
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
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

    if (!pushRes.ok) {
      console.error("Push request failed:", pushRes.status, await pushRes.text());
      return false;
    }

    const pushData = await pushRes.json().catch(() => ({}));
    const sentCount = Number(pushData?.sent ?? 0);
    return sentCount > 0;
  } catch (error) {
    console.error("Push notification error:", error);
    return false;
  }
}

async function getUserEmail(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      console.error("getUserById error:", error);
      return null;
    }
    return data.user?.email ?? null;
  } catch (error) {
    console.error("getUserEmail error:", error);
    return null;
  }
}

async function sendReminderEmail(apiKey: string, to: string, message: string): Promise<boolean> {
  try {
    const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Astraz", email: "xtechnly@gmail.com" },
        to: [{ email: to }],
        subject: `🔔 Reminder: ${message}`,
        htmlContent: `
          <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #00CED1, #9B59B6); padding: 20px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0;">⏰ Reminder</h1>
            </div>
            <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px;">
              <p style="font-size: 16px; color: #333;">${message}</p>
              <a href="https://astraz.lovable.app" style="display: inline-block; background: linear-gradient(135deg, #00CED1, #9B59B6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px;">Open Astraz</a>
            </div>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      console.error("Brevo email error:", emailRes.status, await emailRes.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}
