import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Backend not configured");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Get all due pending reminders
    const { data: reminders, error: fetchErr } = await supabase
      .from("scheduled_notifications")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
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
        // Insert reminder message into the conversation
        if (reminder.conversation_id) {
          await supabase.from("messages").insert({
            conversation_id: reminder.conversation_id,
            role: "assistant",
            content: `[REMINDER] 🔔 ${reminder.message}`,
          });
        }

        // Check user's notification preference
        const { data: profileData } = await supabase
          .from("profiles")
          .select("notification_preference")
          .eq("user_id", reminder.user_id)
          .single();

        const pref = profileData?.notification_preference || "push_and_email";
        const shouldEmail = pref === "push_and_email" || pref === "email_only";

        // Send email notification
        const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
        if (BREVO_API_KEY && reminder.email && shouldEmail) {
          try {
            console.log(`Sending reminder email to ${reminder.email}: ${reminder.message}`);
            const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: {
                "api-key": BREVO_API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                sender: { name: "Astraz", email: "xtechnly@gmail.com" },
                to: [{ email: reminder.email }],
                subject: `🔔 Reminder: ${reminder.message}`,
                htmlContent: `
                  <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #00CED1, #9B59B6); padding: 20px; border-radius: 12px 12px 0 0;">
                      <h1 style="color: white; margin: 0;">⏰ Reminder</h1>
                    </div>
                    <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px;">
                      <p style="font-size: 16px; color: #333;">${reminder.message}</p>
                      <a href="https://astraz.lovable.app" style="display: inline-block; background: linear-gradient(135deg, #00CED1, #9B59B6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px;">Open Astraz</a>
                    </div>
                  </div>
                `,
              }),
            });
            if (!emailRes.ok) {
              const errText = await emailRes.text();
              console.error("Brevo email error:", emailRes.status, errText);
            } else {
              console.log("Reminder email sent successfully to", reminder.email);
            }
          } catch (emailErr) {
            console.error("Email send error:", emailErr);
          }
        } else {
          console.log("Skipping email: BREVO_API_KEY exists:", !!BREVO_API_KEY, "email:", reminder.email);
        }

        // Mark as sent
        await supabase
          .from("scheduled_notifications")
          .update({ status: "sent", updated_at: new Date().toISOString() })
          .eq("id", reminder.id);

        processed++;
      } catch (reminderErr) {
        console.error(`Error processing reminder ${reminder.id}:`, reminderErr);
      }
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
