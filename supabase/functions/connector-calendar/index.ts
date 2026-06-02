import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';

async function gw(path: string, init: RequestInit = {}) {
  const L = Deno.env.get('LOVABLE_API_KEY');
  const K = Deno.env.get('GOOGLE_CALENDAR_API_KEY');
  if (!L || !K) throw new Error('Calendar connector not configured');
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${L}`, 'X-Connection-Api-Key': K, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${text.slice(0, 300)}`);
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

    const { data: conn } = await supabase.from('user_connections').select('enabled').eq('user_id', user.id).eq('provider', 'google_calendar').maybeSingle();
    if (!conn?.enabled) return new Response(JSON.stringify({ error: 'connector_disabled' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { action } = body || {};

    if (action === 'list_upcoming') {
      const max = Math.min(Number(body.maxResults) || 10, 20);
      const now = new Date().toISOString();
      const data = await gw(`/calendars/primary/events?maxResults=${max}&timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime`);
      const events = (data.items || []).map((e: any) => ({
        id: e.id, summary: e.summary, location: e.location,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        link: e.htmlLink,
      }));
      return new Response(JSON.stringify({ action, events }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[connector-calendar]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
