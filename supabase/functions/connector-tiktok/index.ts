import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/tiktok';

async function gw(path: string, init: RequestInit = {}) {
  const L = Deno.env.get('LOVABLE_API_KEY');
  const K = Deno.env.get('TIKTOK_API_KEY');
  if (!L || !K) throw new Error('TikTok connector not configured');
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${L}`, 'X-Connection-Api-Key': K, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`TikTok ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: conn } = await supabase.from('user_connections').select('enabled').eq('user_id', user.id).eq('provider', 'tiktok').maybeSingle();
    if (!conn?.enabled) return new Response(JSON.stringify({ error: 'connector_disabled' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { action } = body || {};

    if (action === 'profile') {
      const data = await gw('/user/info/?fields=open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count', { method: 'GET' });
      return new Response(JSON.stringify({ action, profile: data.data?.user || data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'videos') {
      const data = await gw('/video/list/?fields=id,title,cover_image_url,share_url,view_count,like_count,create_time', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: Math.min(Number(body.maxResults) || 10, 20) }),
      });
      return new Response(JSON.stringify({ action, videos: data.data?.videos || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[connector-tiktok]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
