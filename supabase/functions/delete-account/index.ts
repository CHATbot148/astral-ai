import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error("Backend is not configured (missing keys)");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Verify user
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userId = userData.user.id;

    // Admin client
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Delete storage files under user folder (chat-files bucket)
    // Best-effort: ignore if bucket missing or list fails
    try {
      const prefixes = [userId];
      for (const prefix of prefixes) {
        let offset = 0;
        const limit = 100;

        // list only top-level objects under prefix
        // We'll loop pages; remove per page
        while (true) {
          const { data: list, error: listErr } = await admin.storage
            .from("chat-files")
            .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });

          if (listErr) break;
          if (!list || list.length === 0) break;

          const paths = list
            .filter((o) => !!o.name)
            .map((o) => `${prefix}/${o.name}`);

          if (paths.length) {
            await admin.storage.from("chat-files").remove(paths);
          }

          if (list.length < limit) break;
          offset += limit;
        }
      }
    } catch (e) {
      console.error("Storage cleanup failed:", e);
    }

    // Delete DB rows (public schema)
    await admin.from("messages").delete().in(
      "conversation_id",
      admin.from("conversations").select("id").eq("user_id", userId) as any
    );

    // Safer: do in two steps
    const { data: convs } = await admin.from("conversations").select("id").eq("user_id", userId);
    const convIds = (convs || []).map((c: any) => c.id);
    if (convIds.length) {
      await admin.from("messages").delete().in("conversation_id", convIds);
    }

    await admin.from("user_memory").delete().eq("user_id", userId);
    await admin.from("conversations").delete().eq("user_id", userId);
    await admin.from("profiles").delete().eq("user_id", userId);

    // Delete auth user
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error("Auth delete failed:", delErr);
      return new Response(JSON.stringify({ error: "Failed to delete user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("delete-account error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
