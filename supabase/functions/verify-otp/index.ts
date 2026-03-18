import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, otp, password, name, newPassword, isPasswordReset } = await req.json();
    
    if (!email || !otp) {
      throw new Error("Email and OTP are required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Backend not configured");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Get OTP record by email (we can't query by hash, so get by email then compare)
    const { data: otpRecord, error: otpError } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .single();

    if (otpError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compare OTP with bcrypt hash
    const isValid = await bcrypt.compare(otp, otpRecord.otp_hash);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      // Delete expired OTP
      await supabase.from("email_otps").delete().eq("id", otpRecord.id);
      return new Response(
        JSON.stringify({ error: "Verification code has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete the used OTP
    await supabase.from("email_otps").delete().eq("id", otpRecord.id);

    // Handle password reset
    if (isPasswordReset && newPassword) {
      // Find user by email
      const { data: users, error: listError } = await supabase.auth.admin.listUsers();
      
      if (listError) throw listError;
      
      const user = users.users.find(u => u.email === email);
      
      if (!user) {
        return new Response(
          JSON.stringify({ error: "No account found with this email" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update user's password
      const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
        password: newPassword,
      });

      if (updateError) {
        console.error("Password update error:", updateError);
        throw new Error("Failed to reset password");
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Password reset successfully",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If password provided, create the user account
    if (password) {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name || null },
      });

      if (authError) {
        if (authError.message.includes("already been registered")) {
          return new Response(
            JSON.stringify({ error: "This email is already registered. Please log in instead." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw authError;
      }

      // Create profile
      if (authData.user) {
        await supabase.from("profiles").upsert({
          user_id: authData.user.id,
          full_name: name || null,
        }, { onConflict: "user_id" });
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Account created successfully",
          verified: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Just verification without account creation
    return new Response(
      JSON.stringify({ success: true, verified: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
