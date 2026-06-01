import { useEffect, useState } from 'react';
import { MapPin, Mail, Send, Calendar, Music2, Loader2, Check, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Provider = 'google_maps' | 'telegram' | 'gmail' | 'google_calendar' | 'tiktok';

interface ConnectorDef {
  id: Provider;
  name: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  available: boolean;
  comingSoon?: string;
}

const CONNECTORS: ConnectorDef[] = [
  { id: 'google_maps', name: 'Google Maps', desc: 'Places, directions, geocoding in chat', icon: MapPin, iconColor: 'text-emerald-500', available: true },
  { id: 'telegram', name: 'Telegram', desc: 'Send & receive Telegram messages', icon: Send, iconColor: 'text-sky-500', available: false, comingSoon: 'Bot token needed' },
  { id: 'gmail', name: 'Gmail', desc: 'Send, compose, read, and draft emails', icon: Mail, iconColor: 'text-red-500', available: false, comingSoon: 'OAuth setup pending' },
  { id: 'google_calendar', name: 'Google Calendar', desc: 'Read events & create reminders', icon: Calendar, iconColor: 'text-blue-500', available: false, comingSoon: 'OAuth setup pending' },
  { id: 'tiktok', name: 'TikTok', desc: 'Search trends & post-related actions', icon: Music2, iconColor: 'text-pink-500', available: false, comingSoon: 'OAuth setup pending' },
];

export const ConnectorsSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<Record<Provider, boolean>>({} as any);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<Provider | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('user_connections').select('provider, enabled').eq('user_id', user.id);
      const map: any = {};
      (data || []).forEach((r: any) => { map[r.provider] = r.enabled; });
      setEnabled(map);
      setLoading(false);
    })();
  }, [user]);

  const toggle = async (provider: Provider, value: boolean) => {
    if (!user) return;
    setUpdating(provider);
    const { error } = await supabase.from('user_connections')
      .upsert({ user_id: user.id, provider, enabled: value }, { onConflict: 'user_id,provider' });
    setUpdating(null);
    if (error) {
      toast({ title: 'Failed to update connector', variant: 'destructive' });
      return;
    }
    setEnabled((prev) => ({ ...prev, [provider]: value }));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect external services so Astraz can take actions on your behalf.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {CONNECTORS.map((c) => {
            const Icon = c.icon;
            const isOn = !!enabled[c.id];
            return (
              <div
                key={c.id}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  c.available ? 'bg-secondary/40 border-border' : 'bg-secondary/20 border-border/50 opacity-70'
                )}
              >
                <div className={cn('p-2 rounded-lg bg-background/60 flex-shrink-0', c.iconColor)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{c.name}</p>
                    {isOn && c.available && (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                        <Check className="h-3 w-3" /> Active
                      </span>
                    )}
                    {!c.available && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                  {!c.available && c.comingSoon && (
                    <p className="text-[10px] text-muted-foreground/70 mt-1">{c.comingSoon}</p>
                  )}
                </div>
                {c.available ? (
                  <Switch
                    checked={isOn}
                    disabled={updating === c.id}
                    onCheckedChange={(v) => toggle(c.id, v)}
                  />
                ) : (
                  <ExternalLink className="h-4 w-4 text-muted-foreground/40 mt-2" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
