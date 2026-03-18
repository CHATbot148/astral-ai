import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "xtechnly@gmail.com";

const formatNGN = (amount: number) => `₦${amount.toLocaleString()}`;

function getSubscriptionEmailHTML(data: {
  userName: string;
  tier: string;
  billingCycle: string;
  amount: number;
  autoRenew: boolean;
  savePayment: boolean;
  type: 'subscription' | 'cancellation' | 'renewal';
  refundAmount?: number;
  fee?: number;
}) {
  const { userName, tier, billingCycle, amount, autoRenew, type, refundAmount, fee } = data;
  const gradientBg = 'background: linear-gradient(135deg, #00b8d4, #7c4dff);';

  if (type === 'subscription') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#0f1629;border-radius:16px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
  <tr><td style="padding:0;">
    <div style="${gradientBg} padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;font-size:28px;margin:0 0 8px;">🎉 Welcome to ${tier}!</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:0;">Your subscription is now active</p>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#e0e0e0;font-size:16px;margin:0 0 24px;">Hi ${userName},</p>
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 24px;">Thank you for subscribing to the <strong style="color:#00e5ff;">${tier}</strong> plan!</p>
      <table width="100%" style="background:#1a2035;border-radius:12px;padding:20px;margin:0 0 24px;" cellpadding="8">
        <tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Plan</td><td style="color:#fff;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;font-weight:600;">${tier}</td></tr>
        <tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Billing</td><td style="color:#fff;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;">${billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}</td></tr>
        <tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Amount</td><td style="color:#00e5ff;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;font-weight:600;">${amount === 0 ? 'FREE (Promo)' : formatNGN(amount)}</td></tr>
        <tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Auto-Renew</td><td style="color:#fff;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;">${autoRenew ? '✅ Enabled' : '❌ Disabled'}</td></tr>
        <tr><td style="color:#888;font-size:13px;">Refund Policy</td><td style="color:#ffab40;font-size:12px;text-align:right;">${billingCycle === 'monthly' ? 'Full refund within 72 hours' : 'Full refund within 31 days'}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;line-height:1.5;margin:0 0 16px;">After the free refund period, a 20% cancellation fee applies.</p>
      <div style="text-align:center;margin:24px 0;"><a href="https://astraz.lovable.app" style="${gradientBg} color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Open X-AI</a></div>
    </div>
    <div style="background:#0a0e1a;padding:16px 24px;text-align:center;border-top:1px solid #1a2035;">
      <p style="color:#555;font-size:11px;margin:0;">© ${new Date().getFullYear()} X-AI by X-Technology.</p>
    </div>
  </td></tr>
</table></body></html>`;
  }

  if (type === 'cancellation') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#0f1629;border-radius:16px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
  <tr><td style="padding:0;">
    <div style="background:linear-gradient(135deg, #ff5722, #ff9800);padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;font-size:28px;margin:0 0 8px;">Subscription Cancelled</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:0;">We're sorry to see you go</p>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#e0e0e0;font-size:16px;margin:0 0 24px;">Hi ${userName},</p>
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 24px;">Your <strong style="color:#ff5722;">${tier}</strong> subscription has been cancelled.</p>
      <table width="100%" style="background:#1a2035;border-radius:12px;padding:20px;margin:0 0 24px;" cellpadding="8">
        <tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Plan</td><td style="color:#fff;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;">${tier}</td></tr>
        ${refundAmount !== undefined ? `<tr><td style="color:#888;font-size:13px;border-bottom:1px solid #2a3050;">Refund</td><td style="color:#4caf50;font-size:13px;text-align:right;border-bottom:1px solid #2a3050;">${formatNGN(refundAmount)}</td></tr>` : ''}
        ${fee !== undefined && fee > 0 ? `<tr><td style="color:#888;font-size:13px;">Cancellation Fee (20%)</td><td style="color:#ff5722;font-size:13px;text-align:right;">${formatNGN(fee)}</td></tr>` : ''}
      </table>
      <p style="color:#888;font-size:12px;line-height:1.5;">You can resubscribe anytime. Your data will be preserved.</p>
    </div>
    <div style="background:#0a0e1a;padding:16px 24px;text-align:center;border-top:1px solid #1a2035;">
      <p style="color:#555;font-size:11px;margin:0;">© ${new Date().getFullYear()} X-AI by X-Technology.</p>
    </div>
  </td></tr>
</table></body></html>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#0f1629;border-radius:16px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
  <tr><td style="padding:0;">
    <div style="${gradientBg} padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;font-size:28px;margin:0 0 8px;">🔄 Subscription Renewed</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:0;">Your ${tier} plan has been renewed</p>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#e0e0e0;font-size:16px;margin:0 0 24px;">Hi ${userName},</p>
      <p style="color:#b0b0b0;font-size:14px;line-height:1.6;margin:0 0 16px;">Your subscription has been automatically renewed. Amount charged: <strong style="color:#00e5ff;">${formatNGN(amount)}</strong></p>
    </div>
    <div style="background:#0a0e1a;padding:16px 24px;text-align:center;border-top:1px solid #1a2035;">
      <p style="color:#555;font-size:11px;margin:0;">© ${new Date().getFullYear()} X-AI by X-Technology.</p>
    </div>
  </td></tr>
</table></body></html>`;
}

function getAdminNotificationHTML(data: {
  userName: string; userEmail: string; tier: string; billingCycle: string; amount: number; type: string;
}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#0f1629;border-radius:16px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
  <tr><td style="padding:0;">
    <div style="background:linear-gradient(135deg, #00b8d4, #7c4dff);padding:24px;text-align:center;">
      <h1 style="color:#fff;font-size:22px;margin:0;">📊 X-AI Admin Notification</h1>
    </div>
    <div style="padding:24px;">
      <p style="color:#e0e0e0;font-size:15px;margin:0 0 16px;"><strong>${data.userName}</strong> (${data.userEmail}) ${data.type === 'subscription' ? 'subscribed to' : data.type === 'cancellation' ? 'cancelled' : 'renewed'} the <strong style="color:#00e5ff;">${data.tier}</strong> plan.</p>
      <table width="100%" style="background:#1a2035;border-radius:10px;padding:16px;" cellpadding="6">
        <tr><td style="color:#888;font-size:13px;">User</td><td style="color:#fff;font-size:13px;text-align:right;">${data.userName}</td></tr>
        <tr><td style="color:#888;font-size:13px;">Email</td><td style="color:#fff;font-size:13px;text-align:right;">${data.userEmail}</td></tr>
        <tr><td style="color:#888;font-size:13px;">Plan</td><td style="color:#00e5ff;font-size:13px;text-align:right;">${data.tier}</td></tr>
        <tr><td style="color:#888;font-size:13px;">Amount</td><td style="color:#fff;font-size:13px;text-align:right;">${data.amount === 0 ? 'FREE (Promo)' : formatNGN(data.amount)}</td></tr>
        <tr><td style="color:#888;font-size:13px;">Event</td><td style="color:#ffab40;font-size:13px;text-align:right;">${data.type.toUpperCase()}</td></tr>
      </table>
    </div>
    <div style="background:#0a0e1a;padding:12px 24px;text-align:center;border-top:1px solid #1a2035;">
      <p style="color:#555;font-size:11px;margin:0;">X-AI Admin Dashboard</p>
    </div>
  </td></tr>
</table></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Backend not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    if (!BREVO_API_KEY) throw new Error("Email service not configured");

    const body = await req.json();
    const { type, userEmail, userName, tier, billingCycle, amount, autoRenew, savePayment, refundAmount, fee } = body;

    const userHTML = getSubscriptionEmailHTML({ userName, tier, billingCycle, amount, autoRenew: autoRenew || false, savePayment: savePayment || false, type, refundAmount, fee });
    const adminHTML = getAdminNotificationHTML({ userName, userEmail, tier, billingCycle, amount, type });

    const subjectMap: Record<string, string> = {
      subscription: `Welcome to X-AI ${tier}! 🎉`,
      cancellation: `X-AI ${tier} Subscription Cancelled`,
      renewal: `X-AI ${tier} Subscription Renewed 🔄`,
    };

    const adminSubjectMap: Record<string, string> = {
      subscription: `📊 ${userName} subscribed to ${tier}`,
      cancellation: `📊 ${userName} cancelled ${tier}`,
      renewal: `📊 ${userName} renewed ${tier}`,
    };

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "X-AI", email: "noreply@x-ai.app" },
        to: [{ email: userEmail, name: userName }],
        subject: subjectMap[type] || `X-AI Subscription Update`,
        htmlContent: userHTML,
      }),
    });

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "X-AI System", email: "noreply@x-ai.app" },
        to: [{ email: ADMIN_EMAIL, name: "X-Tech Admin" }],
        subject: adminSubjectMap[type] || `X-AI Admin: Subscription Update`,
        htmlContent: adminHTML,
      }),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("subscription-email error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
