import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name } = await req.json();
    
    if (!email) {
      throw new Error("Email is required");
    }

    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!BREVO_API_KEY) {
      throw new Error("BREVO_API_KEY is not configured");
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Backend not configured");
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    
    // Delete any existing OTPs for this email
    await supabase.from("email_otps").delete().eq("email", email);
    
    // Insert new OTP
    const { error: insertError } = await supabase.from("email_otps").insert({
      email,
      otp_hash: otp, // In production, hash this
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      throw new Error("Failed to store OTP");
    }

    // Send email via Brevo
    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "X-AI",
          email: "xtechnly@gmail.com",
        },
        to: [{ email, name: name || email }],
        subject: "Your X-AI Verification Code",
        htmlContent: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #ffffff; padding: 40px; }
              .container { max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(0, 212, 255, 0.2); }
              .logo { text-align: center; margin-bottom: 24px; }
              .logo-text { font-size: 28px; font-weight: bold; background: linear-gradient(90deg, #00d4ff, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
              h1 { font-size: 24px; margin-bottom: 16px; text-align: center; }
              .otp-box { background: rgba(0, 212, 255, 0.1); border: 2px solid #00d4ff; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
              .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #00d4ff; }
              .expire-text { color: #888; font-size: 14px; text-align: center; margin-top: 16px; }
              .footer { text-align: center; margin-top: 32px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">
                <span class="logo-text">X-AI</span>
              </div>
              <h1>Verify Your Email</h1>
              <p style="text-align: center; color: #aaa;">Enter this code to complete your sign up:</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <p class="expire-text">This code expires in 10 minutes</p>
              <div class="footer">
                <p>Made by X-Tech</p>
                <p>If you didn't request this code, you can safely ignore this email.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Brevo API error:", emailResponse.status, errorText);
      throw new Error("Failed to send verification email");
    }

    return new Response(
      JSON.stringify({ success: true, message: "Verification code sent" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send OTP error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
