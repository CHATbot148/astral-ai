import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashOtp(otp: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${otp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `sha256$${salt}$${bytesToHex(new Uint8Array(digest))}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, isPasswordReset } = await req.json();
    
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
    const otpHash = await hashOtp(otp, randomSalt());
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    
    // Delete any existing OTPs for this email
    await supabase.from("email_otps").delete().eq("email", email);
    
    // Insert new OTP (hashed)
    const { error: insertError } = await supabase.from("email_otps").insert({
      email,
      otp_hash: otpHash,
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      throw new Error("Failed to store OTP");
    }

    const subject = isPasswordReset ? "Reset Your Astraz Password" : "Your Astraz Verification Code";
    const heading = isPasswordReset ? "Reset Your Password" : "Verify Your Email";
    const description = isPasswordReset
      ? "Enter this code to reset your password:"
      : "Enter this code to complete your sign up:";

    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Astraz", email: "xtechnly@gmail.com" },
        to: [{ email, name: name || email }],
        subject,
        htmlContent: `
          <!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;padding:40px 16px">
            <div style="max-width:500px;margin:0 auto;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:40px;border:1px solid rgba(0,212,255,0.2)">
              <div style="text-align:center;margin-bottom:24px"><span style="font-size:28px;font-weight:800;background:linear-gradient(90deg,#00d4ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Astraz</span></div>
              <h1 style="font-size:24px;margin:0 0 16px;text-align:center">${heading}</h1>
              <p style="text-align:center;color:#aaa">${description}</p>
              <div style="background:rgba(0,212,255,0.1);border:2px solid #00d4ff;border-radius:12px;padding:20px;text-align:center;margin:24px 0">
                <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#00d4ff">${otp}</div>
              </div>
              <p style="color:#888;font-size:14px;text-align:center;margin-top:16px">This code expires in 10 minutes</p>
              <div style="text-align:center;margin-top:32px;color:#666;font-size:12px">
                <p>Made by Astrinique · <a href="https://astraz.online" style="color:#00d4ff;text-decoration:none">astraz.online</a></p>
                <p>If you didn't request this code, you can safely ignore this email.</p>
              </div>
            </div>
          </body></html>
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
