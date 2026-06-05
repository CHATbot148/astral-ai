import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Crown, Sparkles, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription, SubscriptionTier, BillingCycle, TIER_CONFIGS } from '@/hooks/useSubscription';

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
  const navigate = useNavigate();
  const { tier: currentTier } = useSubscription();
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>('pro');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  const reasonText = reason === 'image_limit'
    ? "You've reached your daily image generation limit."
    : reason === 'video_limit'
    ? "You've reached your daily video generation limit."
    : 'Unlock more features with a premium plan.';

  const tierOrder: SubscriptionTier[] = ['free', 'basic', 'pro', 'ultimate'];
  const availableTiers: SubscriptionTier[] = (['basic', 'pro', 'ultimate'] as SubscriptionTier[]).filter(
    t => tierOrder.indexOf(t) > tierOrder.indexOf(currentTier)
  );

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
                        <p className="flex items-center gap-1 text-xai-purple">
                          <Brain className="h-3 w-3" /> Astraz Pro model unlocked (smartest)
                        </p>
                        <p>• {config.limits.imagesPerDay === Infinity ? 'Unlimited' : config.limits.imagesPerDay} images/day ({config.limits.imageQuality} quality)</p>
                        <p>• {config.limits.videosPerDay === Infinity ? 'Unlimited' : config.limits.videosPerDay} videos/day ({config.limits.videoQuality} quality)</p>
                        {!config.limits.watermark && <p className="text-xai-cyan">• No watermarks</p>}
                        {config.limits.anyModel && <p className="text-xai-purple">• Any Leonardo AI model</p>}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <Button
                variant="xai"
                className="w-full h-12"
                onClick={() => {
                  onClose();
                  navigate(`/payment?tier=${selectedTier}&cycle=${billingCycle}&reason=${reason}`);
                }}
              >
                Continue to Payment — {formatNGN(billingCycle === 'monthly' ? TIER_CONFIGS[selectedTier].price.monthly : TIER_CONFIGS[selectedTier].price.yearly)}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>

    </AnimatePresence>
  );
};
