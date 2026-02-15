import { useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Zap, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSubscription, TIER_CONFIGS, SubscriptionTier } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ManageSubscriptionProps {
  onUpgrade: () => void;
}

const tierIcons: Record<SubscriptionTier, React.ReactNode> = {
  free: null,
  basic: <Zap className="h-4 w-4" />,
  pro: <Sparkles className="h-4 w-4" />,
  ultimate: <Crown className="h-4 w-4" />,
};

const formatNGN = (amount: number) => `₦${amount.toLocaleString()}`;

export const ManageSubscription = ({ onUpgrade }: ManageSubscriptionProps) => {
  const { subscription, tier, tierConfig } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const { cancelSubscription } = useSubscription();

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      const { refundEligible, fee } = await cancelSubscription();

      // Subscription emails disabled for now

      if (refundEligible) {
        toast({ title: 'Subscription cancelled', description: 'Full refund will be processed.' });
      } else {
        toast({ title: 'Subscription cancelled', description: `A ${formatNGN(fee)} cancellation fee applies.` });
      }
      setShowCancelConfirm(false);
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
            {subscription?.status === 'active' ? 'Active' : subscription?.status}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground space-y-1 mb-3">
          <p>Billing: {subscription?.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly'}</p>
          {subscription?.expires_at && (
            <p>Renews: {new Date(subscription.expires_at).toLocaleDateString()}</p>
          )}
          <p>Auto-renew: {subscription?.auto_renew ? 'On' : 'Off'}</p>
        </div>

        {tier !== 'ultimate' && (
          <Button variant="xai" size="sm" className="w-full mb-2" onClick={onUpgrade}>
            Upgrade Plan
          </Button>
        )}

        {subscription?.status === 'active' && !showCancelConfirm && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowCancelConfirm(true)}
          >
            Cancel Subscription
          </Button>
        )}

        {showCancelConfirm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 mt-2"
          >
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground">
                {(() => {
                  if (!subscription) return '';
                  const startDate = new Date(subscription.started_at);
                  const daysSince = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24);
                  const freeWindow = subscription.billing_cycle === 'monthly' ? 3 : 31;
                  if (daysSince <= freeWindow) {
                    return 'You are within the free cancellation window. Full refund will be issued.';
                  }
                  const price = subscription.billing_cycle === 'monthly'
                    ? TIER_CONFIGS[tier].price.monthly
                    : TIER_CONFIGS[tier].price.yearly;
                  return `A 20% cancellation fee of ${formatNGN(price * 0.2)} applies.`;
                })()}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCancelConfirm(false)}>Keep Plan</Button>
              <Button variant="destructive" size="sm" onClick={handleCancel} disabled={isCancelling}>
                {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Cancel'}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
