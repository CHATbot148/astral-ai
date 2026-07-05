import { useEffect, useState } from 'react';
import { Loader2, Check, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { BRAND_ICON } from '@/components/icons/BrandIcons';

type Provider = 'google_maps' | 'telegram' | 'gmail' | 'google_calendar' | 'tiktok';

interface ConnectorDef {
  id: Provider;
  name: string;
  desc: string;
  oauth: 'google' | null; // requires per-user OAuth
}

const CONNECTORS: ConnectorDef[] = [
  { id: 'gmail', name: 'Gmail', desc: 'Connect your Gmail to read, send, compose & draft emails', oauth: 'google' },
  { id: 'google_calendar', name: 'Google Calendar', desc: 'Connect your calendar to read events & schedule new ones', oauth: 'google' },
  { id: 'google_maps', name: 'Google Maps', desc: 'Places, directions & interactive maps in chat', oauth: null },
  { id: 'telegram', name: 'Telegram', desc: 'Send Telegram messages from chat', oauth: null },
  { id: 'tiktok', name: 'TikTok', desc: 'Access your TikTok profile & videos', oauth: null },
];

export const ConnectorsSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<Provider, { enabled: boolean; email?: string; hasTokens: boolean }>>({} as any);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<Provider | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_connections')
      .select('provider, enabled, metadata')
      .eq('user_id', user.id);
    const map: any = {};
    (data || []).forEach((r: any) => {
      map[r.provider] = {
        enabled: r.enabled,
        email: r.metadata?.email,
        hasTokens: !!r.enabled,
      };
    });
    setRows(map);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  // Listen for OAuth-callback message to refresh
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'google-oauth-connected') load();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line
  }, []);

  const startGoogleOAuth = async (provider: Provider) => {
    setUpdating(provider);
    try {
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { provider, returnTo: window.location.href },
      });
      if (error || !data?.url) throw new Error(error?.message || 'Failed to start OAuth');
      const popup = window.open(data.url, 'google-oauth', 'width=520,height=640');
      if (!popup) window.location.href = data.url;
    } catch (e: any) {
      toast({ title: 'Failed to start Google sign-in', description: e?.message, variant: 'destructive' });
    } finally {
      setUpdating(null);
    }
  };

  const toggle = async (c: ConnectorDef, value: boolean) => {
    if (!user) return;
    // Google OAuth providers: turning ON without tokens → start OAuth flow
    if (value && c.oauth === 'google' && !rows[c.id]?.hasTokens) {
      await startGoogleOAuth(c.id);
      return;
    }
    setUpdating(c.id);
    const { error } = await supabase.from('user_connections')
      .upsert({ user_id: user.id, provider: c.id, enabled: value }, { onConflict: 'user_id,provider' });
    setUpdating(null);
    if (error) {
      toast({ title: 'Failed to update connector', variant: 'destructive' });
      return;
    }
    setRows((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] || { hasTokens: false }), enabled: value } }));
  };

  const disconnect = async (provider: Provider) => {
    if (!user) return;
    setUpdating(provider);
    const { error } = await supabase.from('user_connections')
      .update({ enabled: false, oauth_tokens: null })
      .eq('user_id', user.id).eq('provider', provider);
    setUpdating(null);
    if (error) {
      toast({ title: 'Failed to disconnect', variant: 'destructive' });
      return;
    }
    setRows((prev) => ({ ...prev, [provider]: { enabled: false, hasTokens: false } }));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect external services to your own account so Astraz can act on your behalf.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {CONNECTORS.map((c) => {
            const Icon = BRAND_ICON[c.id];
            const r = rows[c.id] || { enabled: false, hasTokens: false };
            const isOn = r.enabled && (c.oauth !== 'google' || r.hasTokens);
            return (
              <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-secondary/40 transition-colors">
                <div className="p-1.5 rounded-lg bg-background/60 flex-shrink-0">
                  {Icon ? <Icon className="h-6 w-6" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{c.name}</p>
                    {isOn && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                        <Check className="h-3 w-3" /> Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                  {c.oauth === 'google' && r.email && (
                    <p className="text-[11px] text-muted-foreground/80 mt-1 truncate">{r.email}</p>
                  )}
                  {c.oauth === 'google' && isOn && (
                    <button
                      onClick={() => disconnect(c.id)}
                      className="text-[11px] text-destructive hover:underline mt-1"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                {c.oauth === 'google' && !r.hasTokens ? (
                  <button
                    onClick={() => startGoogleOAuth(c.id)}
                    disabled={updating === c.id}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1 disabled:opacity-50"
                  >
                    {updating === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                    Connect
                  </button>
                ) : (
                  <Switch
                    checked={isOn}
                    disabled={updating === c.id}
                    onCheckedChange={(v) => toggle(c, v)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
