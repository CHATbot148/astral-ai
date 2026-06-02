import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

async function gw(path: string, init: RequestInit = {}) {
  const L = Deno.env.get('LOVABLE_API_KEY');
  const K = Deno.env.get('GOOGLE_MAIL_API_KEY');
  if (!L || !K) throw new Error('Gmail connector not configured');
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${L}`, 'X-Connection-Api-Key': K, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

function b64url(s: string) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: conn } = await supabase.from('user_connections').select('enabled').eq('user_id', user.id).eq('provider', 'gmail').maybeSingle();
    if (!conn?.enabled) return new Response(JSON.stringify({ error: 'connector_disabled' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { action } = body || {};

    if (action === 'list') {
      const q = encodeURIComponent(body.query || '');
      const max = Math.min(Number(body.maxResults) || 10, 20);
      const list = await gw(`/users/me/messages?maxResults=${max}&q=${q}`);
      const ids = (list.messages || []).slice(0, max).map((m: any) => m.id);
      const items = await Promise.all(ids.map(async (id: string) => {
        const m = await gw(`/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const h = (m.payload?.headers || []) as any[];
        const pick = (n: string) => h.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value;
        return { id, from: pick('From'), subject: pick('Subject'), date: pick('Date'), snippet: m.snippet };
      }));
      return new Response(JSON.stringify({ action, messages: items }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'send' || action === 'draft') {
      const { to, subject, body: textBody } = body;
      if (!to || !textBody) throw new Error('to and body required');
      const raw = b64url([`To: ${to}`, `Subject: ${subject || '(no subject)'}`, 'Content-Type: text/plain; charset="UTF-8"', '', textBody].join('\r\n'));
      if (action === 'send') {
        const res = await gw('/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
        return new Response(JSON.stringify({ action, id: res.id, threadId: res.threadId, sent: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const res = await gw('/users/me/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }) });
      return new Response(JSON.stringify({ action, draftId: res.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[connector-gmail]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
