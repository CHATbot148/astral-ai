import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public callback (no JWT). Google posts the code via redirect.
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
    const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
    const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;

    if (error || !code || !stateRaw) {
      return htmlResponse(`<h2>Connection failed</h2><p>${error || "Missing code"}</p><script>setTimeout(()=>window.close(),3000)</script>`);
    }

    const state = JSON.parse(atob(stateRaw));
    const { user_id, provider, return_to } = state;

    // Exchange code for tokens
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok) {
      return htmlResponse(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tok).slice(0, 600)}</pre>`);
    }

    // Fetch email for metadata
    let email: string | null = null;
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => r.json());
      email = me?.email || null;
    } catch {}

    const expiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
    const tokens = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: expiresAt,
      scope: tok.scope,
      token_type: tok.token_type,
    };

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from("user_connections").upsert({
      user_id, provider, enabled: true, oauth_tokens: tokens,
      metadata: { email, connected_at: new Date().toISOString() },
    }, { onConflict: "user_id,provider" });

    const target = return_to || "/";
    return htmlResponse(`
      <!DOCTYPE html><html><head><title>Connected</title><style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;border-radius:16px;text-align:center;max-width:380px}.title{font-size:22px;margin:8px 0}.email{color:#00d4ff;font-size:14px;margin-top:8px}</style></head>
      <body><div class="card">
        <div style="font-size:48px">✅</div>
        <div class="title">${provider === "gmail" ? "Gmail" : "Google Calendar"} connected</div>
        ${email ? `<div class="email">${email}</div>` : ""}
        <p style="opacity:.7;font-size:13px;margin-top:16px">Redirecting you back to Astraz…</p>
      </div>
      <script>setTimeout(()=>{try{window.opener&&window.opener.postMessage({type:'google-oauth-connected',provider:'${provider}'},'*')}catch(e){};window.location.replace(${JSON.stringify(target)})},1200)</script>
      </body></html>`);
  } catch (e: any) {
    return htmlResponse(`<h2>Connection error</h2><pre>${e?.message || "Unknown"}</pre>`);
  }
});

function htmlResponse(html: string) {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
