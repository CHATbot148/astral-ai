import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_maps';

async function gw(path: string, init: RequestInit = {}) {
  const LOVABLE = Deno.env.get('LOVABLE_API_KEY');
  const KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!LOVABLE || !KEY) throw new Error('Google Maps connector not configured');
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LOVABLE}`,
      'X-Connection-Api-Key': KEY,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Maps ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Auth check
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Check user enabled connector
    const { data: conn } = await supabase.from('user_connections').select('enabled').eq('user_id', user.id).eq('provider', 'google_maps').maybeSingle();
    if (!conn?.enabled) {
      return new Response(JSON.stringify({ error: 'connector_disabled' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { action, query, origin, destination, mode = 'driving', latitude, longitude } = body || {};

    if (action === 'search_places') {
      if (!query || typeof query !== 'string') throw new Error('query required');
      const data = await gw('/places/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri,places.googleMapsUri,places.regularOpeningHours',
        },
        body: JSON.stringify({ textQuery: query.slice(0, 200) }),
      });
      const places = (data.places || []).slice(0, 6).map((p: any) => ({
        name: p.displayName?.text,
        address: p.formattedAddress,
        rating: p.rating,
        reviews: p.userRatingCount,
        priceLevel: p.priceLevel,
        website: p.websiteUri,
        mapsUrl: p.googleMapsUri,
        openNow: p.regularOpeningHours?.openNow,
        location: p.location,
      }));
      return new Response(JSON.stringify({ action, places }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'geocode') {
      if (!query) throw new Error('query required');
      const data = await gw(`/maps/api/geocode/json?address=${encodeURIComponent(query)}`);
      return new Response(JSON.stringify({ action, results: (data.results || []).slice(0, 3) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'directions') {
      if (!origin || !destination) throw new Error('origin and destination required');
      const data = await gw('/routes/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters',
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: mode.toUpperCase(),
        }),
      });
      const route = data.routes?.[0];
      const steps = (route?.legs?.[0]?.steps || []).slice(0, 12).map((s: any) => ({
        instruction: s.navigationInstruction?.instructions,
        meters: s.distanceMeters,
      }));
      return new Response(JSON.stringify({ action, duration: route?.duration, distanceMeters: route?.distanceMeters, steps }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'nearby') {
      if (latitude == null || longitude == null) throw new Error('latitude/longitude required');
      const data = await gw('/places/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.googleMapsUri',
        },
        body: JSON.stringify({
          locationRestriction: { circle: { center: { latitude, longitude }, radius: 1500 } },
          includedTypes: body.types || undefined,
          maxResultCount: 8,
        }),
      });
      return new Response(JSON.stringify({ action, places: data.places || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[connector-maps]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
