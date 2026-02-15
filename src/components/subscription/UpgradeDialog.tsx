import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Zap, Crown, Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useSubscription, SubscriptionTier, BillingCycle, TIER_CONFIGS } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';

interface UpgradeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'image_limit' | 'video_limit' | 'general';
}

const tierIcons: Record<SubscriptionTier, React.ReactNode> = {
  free: null,
  basic: <Zap className="h-5 w-5" />,
  pro: <Sparkles className="h-5 w-5" />,
  ultimate: <Crown className="h-5 w-5" />,
};

const formatNGN = (amount: number) => `₦${amount.toLocaleString()}`;

export const UpgradeDialog = ({ isOpen, onClose, reason = 'general' }: UpgradeDialogProps) => {
  const { tier: currentTier, subscribe } = useSubscription();
  const { toast } = useToast();
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>('pro');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [autoRenew, setAutoRenew] = useState(true);
  const [savePayment, setSavePayment] = useState(false);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  const reasonText = reason === 'image_limit'
    ? "You've reached your daily image generation limit."
    : reason === 'video_limit'
    ? "You've reached your daily video generation limit."
    : 'Unlock more features with a premium plan.';

  const availableTiers: SubscriptionTier[] = ['basic', 'pro', 'ultimate'].filter(
    t => (['free', 'basic', 'pro', 'ultimate'] as SubscriptionTier[]).indexOf(t as SubscriptionTier) > (['free', 'basic', 'pro', 'ultimate'] as SubscriptionTier[]).indexOf(currentTier)
  ) as SubscriptionTier[];

  const handleSubscribe = async () => {
    if (!agreedToPolicy) {
      toast({ title: 'Please agree to the Privacy Policy', variant: 'destructive' });
      return;
    }
    setIsSubscribing(true);
    try {
      await subscribe(selectedTier, billingCycle, autoRenew, savePayment);
      toast({ title: `Subscribed to ${TIER_CONFIGS[selectedTier].name}!`, description: 'Your plan is now active (mock mode).' });
      onClose();
    } catch (e) {
      toast({ title: 'Subscription failed', variant: 'destructive' });
    } finally {
      setIsSubscribing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative z-10 w-full max-w-lg"
        >
          <div className="xai-gradient-border rounded-xl">
            <div className="xai-gradient-border-content rounded-xl bg-card p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-display font-bold xai-gradient-text">Upgrade Plan</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
              </div>

              <p className="text-sm text-muted-foreground mb-4">{reasonText}</p>

              {/* Billing toggle */}
              <div className="flex items-center gap-2 p-1 rounded-lg bg-secondary/50 mb-4">
                {(['monthly', 'yearly'] as BillingCycle[]).map(cycle => (
                  <button
                    key={cycle}
                    onClick={() => setBillingCycle(cycle)}
                    className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                      billingCycle === cycle ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {cycle === 'monthly' ? 'Monthly' : 'Yearly (30% off)'}
                  </button>
                ))}
              </div>

              {/* Tier cards */}
              <div className="space-y-3 mb-4">
                {availableTiers.map(t => {
                  const config = TIER_CONFIGS[t];
                  const price = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
                  const isSelected = selectedTier === t;

                  return (
                    <motion.button
                      key={t}
                      onClick={() => setSelectedTier(t)}
                      whileHover={{ scale: 1.01 }}
                      className={`w-full p-4 rounded-lg border text-left transition-all ${
                        isSelected ? 'border-xai-cyan bg-xai-cyan/10' : 'border-border hover:border-xai-cyan/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={isSelected ? 'text-xai-cyan' : 'text-muted-foreground'}>{tierIcons[t]}</span>
                          <span className={`font-semibold ${isSelected ? 'text-xai-cyan' : ''}`}>{config.name}</span>
                        </div>
                        <span className="font-bold">{formatNGN(price)}<span className="text-xs text-muted-foreground">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span></span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>• {config.limits.imagesPerDay === Infinity ? 'Unlimited' : config.limits.imagesPerDay} images/day ({config.limits.imageQuality} quality)</p>
                        <p>• {config.limits.videosPerDay === Infinity ? 'Unlimited' : config.limits.videosPerDay} videos/day ({config.limits.videoQuality} quality)</p>
                        {!config.limits.watermark && <p className="text-xai-cyan">• No watermarks</p>}
                        {config.limits.anyModel && <p className="text-xai-purple">• Any Leonardo AI model</p>}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {/* Refund policy warning */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-4">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {billingCycle === 'monthly'
                    ? 'Full refund within 72 hours of purchase. After 72 hours, a 20% cancellation fee applies.'
                    : 'Full refund within 31 days of purchase. After 31 days, a 20% cancellation fee applies.'}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-3 mb-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={autoRenew} onCheckedChange={(c) => setAutoRenew(!!c)} />
                  <span className="text-sm">Auto-renew subscription</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={savePayment} onCheckedChange={(c) => setSavePayment(!!c)} />
                  <span className="text-sm">Save payment method for future purchases</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={agreedToPolicy} onCheckedChange={(c) => setAgreedToPolicy(!!c)} />
                  <span className="text-sm">
                    I agree to the{' '}
                    <a href="/privacy-policy" target="_blank" className="text-xai-cyan hover:underline">
                      Privacy Policy & Terms
                    </a>
                  </span>
                </label>
              </div>

              <Button
                variant="xai"
                className="w-full h-12"
                onClick={handleSubscribe}
                disabled={isSubscribing || !agreedToPolicy}
              >
                {isSubscribing ? 'Processing...' : `Subscribe to ${TIER_CONFIGS[selectedTier].name} — ${formatNGN(billingCycle === 'monthly' ? TIER_CONFIGS[selectedTier].price.monthly : TIER_CONFIGS[selectedTier].price.yearly)}`}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
