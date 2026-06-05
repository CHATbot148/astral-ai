// Shared helper to fetch a fresh Google OAuth access token for a given (user, provider).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function getFreshGoogleAccessToken(
  admin: ReturnType<typeof createClient>,
  userId: string,
  provider: "gmail" | "google_calendar",
): Promise<string> {
  const { data: conn } = await admin
    .from("user_connections")
    .select("oauth_tokens, enabled")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn?.enabled) throw new Error("connector_disabled");
  const tokens = conn.oauth_tokens as any;
  if (!tokens?.access_token) throw new Error("connector_not_authorized");

  // Refresh if < 60s remaining
  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60_000) {
    if (!tokens.refresh_token) throw new Error("connector_not_authorized");
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok) throw new Error(`refresh_failed: ${JSON.stringify(tok).slice(0, 200)}`);
    const updated = {
      ...tokens,
      access_token: tok.access_token,
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
    };
    await admin.from("user_connections").update({ oauth_tokens: updated }).eq("user_id", userId).eq("provider", provider);
    return updated.access_token;
  }
  return tokens.access_token;
}
