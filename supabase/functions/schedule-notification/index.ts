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
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Backend not configured");
    }

    // Authenticate the user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use verified user ID from JWT — never trust client-supplied userId
    const userId = claimsData.claims.sub as string;

    const { message, scheduledFor, conversationId, type = "reminder" } = await req.json();

    // Get user email
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      throw new Error("User not found");
    }

    const userEmail = userData.user.email;

    // Store scheduled notification in database
    const { error: insertError } = await supabase
      .from("scheduled_notifications")
      .insert({
        user_id: userId,
        message,
        scheduled_for: scheduledFor,
        conversation_id: conversationId,
        type,
        status: "pending",
        email: userEmail,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
    }

    // If scheduled for now or past, send immediately
    const scheduledDate = new Date(scheduledFor);
    const now = new Date();

    if (scheduledDate <= now) {
      if (BREVO_API_KEY) {
        await sendEmail(BREVO_API_KEY, userEmail, message, type);
      }

      return new Response(
        JSON.stringify({ success: true, sent: true, message: "Notification sent immediately" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: false, 
        scheduledFor: scheduledFor,
        message: `Notification scheduled for ${scheduledDate.toLocaleString()}` 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Schedule notification error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendEmail(apiKey: string, to: string, message: string, type: string) {
  const subject = type === "reminder" 
    ? "🔔 Reminder from X-AI" 
    : type === "checkin" 
    ? "👋 X-AI misses you!" 
    : "💬 Message from X-AI";

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #00CED1, #9B59B6); padding: 20px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">X-AI</h1>
      </div>
      <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; line-height: 1.6; color: #333;">${message}</p>
        <a href="https://xai.app" style="display: inline-block; background: linear-gradient(135deg, #00CED1, #9B59B6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px; font-weight: 500;">Open X-AI</a>
      </div>
      <p style="text-align: center; color: #888; font-size: 12px; margin-top: 16px;">
        Sent by X-AI, a product of X-Tech
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
      sender: { name: "X-AI", email: "noreply@xai.app" },
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
