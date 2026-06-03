import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Crown, Zap, Sparkles, AlertTriangle, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useSubscription, SubscriptionTier } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectLocale, getCachedLocale, formatLocalPrice, CANCEL_FEE_NGN, type LocaleInfo } from '@/lib/pricing';

interface ManageSubscriptionProps {
  onUpgrade: () => void;
}

const tierIcons: Record<SubscriptionTier, React.ReactNode> = {
  free: null,
  basic: <Zap className="h-4 w-4" />,
  pro: <Sparkles className="h-4 w-4" />,
  ultimate: <Crown className="h-4 w-4" />,
};

type CancelMode = null | 'choose' | 'end_of_period' | 'immediate_refund';

export const ManageSubscription = ({ onUpgrade }: ManageSubscriptionProps) => {
  const { subscription, tier, tierConfig } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();
  const [cancelMode, setCancelMode] = useState<CancelMode>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelPassword, setCancelPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [locale, setLocale] = useState<LocaleInfo>(getCachedLocale());

  useEffect(() => { detectLocale().then(setLocale); }, []);

  const accessUntil = subscription?.access_until || subscription?.expires_at;
  const isCancelledWithGrace = subscription?.cancellation_type === 'end_of_period';

  const handleCancel = async (mode: 'end_of_period' | 'immediate_refund') => {
    if (mode === 'immediate_refund') {
      if (!cancelPassword.trim()) { setPasswordError('Password required'); return; }
    }
    setIsCancelling(true); setPasswordError('');
    try {
      if (mode === 'immediate_refund') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user!.email!, password: cancelPassword,
        });
        if (signInError) { setPasswordError('Incorrect password'); setIsCancelling(false); return; }
      }
      const { data, error } = await supabase.functions.invoke('paystack-cancel', { body: { mode } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || 'Cancel failed');

      if (mode === 'end_of_period') {
        toast({
          title: 'Subscription cancelled',
          description: `You'll keep access until ${new Date(accessUntil!).toLocaleDateString()}.`,
        });
      } else {
        toast({
          title: 'Subscription cancelled & refunded',
          description: `${formatLocalPrice(CANCEL_FEE_NGN, locale.currency)} fee applied. Refund issued.`,
        });
      }
      setCancelMode(null); setCancelPassword('');
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast({ title: 'Failed to cancel', variant: 'destructive' });
    } finally {
      setIsCancelling(false);
    }
  };

  if (tier === 'free') {
    return (
      <div className="p-4 rounded-lg border border-border bg-secondary/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Current Plan</span>
          <Badge variant="secondary">Free</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {tierConfig.limits.imagesPerDay} images/day, no video generation
        </p>
        <Button variant="xai" size="sm" className="w-full" onClick={onUpgrade}>
          Upgrade Plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg border border-xai-cyan/30 bg-xai-cyan/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xai-cyan">{tierIcons[tier]}</span>
            <span className="font-semibold">{tierConfig.name}</span>
          </div>
          <Badge className="bg-xai-cyan/20 text-xai-cyan border-xai-cyan/30">
            {isCancelledWithGrace ? 'Active (cancels soon)' : subscription?.status}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground space-y-1 mb-3">
          <p>Billing: {subscription?.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly'}</p>
          {accessUntil && (
            <p>{isCancelledWithGrace ? 'Access ends' : 'Renews'}: {new Date(accessUntil).toLocaleDateString()}</p>
          )}
          <p>Auto-renew: {subscription?.auto_renew ? 'On' : 'Off'}</p>
        </div>

        {tier !== 'ultimate' && !isCancelledWithGrace && (
          <Button variant="xai" size="sm" className="w-full mb-2" onClick={onUpgrade}>
            Upgrade Plan
          </Button>
        )}

        {!isCancelledWithGrace && subscription?.status === 'active' && !cancelMode && (
          <Button
            variant="ghost" size="sm"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setCancelMode('choose')}
          >
            Cancel Subscription
          </Button>
        )}

        {cancelMode === 'choose' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="space-y-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground">Choose how to cancel:</p>

            <button onClick={() => setCancelMode('end_of_period')}
              className="w-full text-left p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 transition">
              <p className="text-sm font-medium">Keep access until period ends</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No refund, no fees. You keep {tierConfig.name} features until {accessUntil ? new Date(accessUntil).toLocaleDateString() : 'expiry'}.
              </p>
            </button>

            <button onClick={() => setCancelMode('immediate_refund')}
              className="w-full text-left p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition">
              <p className="text-sm font-medium">Cancel now & get refund</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Access ends immediately. A {formatLocalPrice(CANCEL_FEE_NGN, locale.currency)} cancellation fee applies; the rest is refunded.
              </p>
            </button>

            <Button variant="ghost" size="sm" className="w-full" onClick={() => setCancelMode(null)}>
              Keep my plan
            </Button>
          </motion.div>
        )}

        {cancelMode === 'end_of_period' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="p-3 rounded-lg border border-border bg-secondary/30 mt-2 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                You'll keep {tierConfig.name} access until <strong>{accessUntil ? new Date(accessUntil).toLocaleDateString() : 'expiry'}</strong>, then auto-downgrade to Free. No further charges.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setCancelMode('choose')}>Back</Button>
              <Button variant="destructive" size="sm" className="flex-1" onClick={() => handleCancel('end_of_period')} disabled={isCancelling}>
                {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Cancel'}
              </Button>
            </div>
          </motion.div>
        )}

        {cancelMode === 'immediate_refund' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 mt-2 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Cancel immediately. A <strong>{formatLocalPrice(CANCEL_FEE_NGN, locale.currency)}</strong> fee will be deducted; the remainder is refunded to your card.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Lock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Enter password to confirm</span>
              </div>
              <Input type="password" placeholder="Your account password" value={cancelPassword}
                onChange={(e) => { setCancelPassword(e.target.value); setPasswordError(''); }}
                className="h-8 text-sm" />
              {passwordError && <p className="text-xs text-destructive mt-1">{passwordError}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setCancelMode('choose')}>Back</Button>
              <Button variant="destructive" size="sm" className="flex-1" onClick={() => handleCancel('immediate_refund')} disabled={isCancelling}>
                {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel & Refund'}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
