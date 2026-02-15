import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, Building2, Smartphone, Gift, Loader2, Check, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSubscription, SubscriptionTier, BillingCycle, TIER_CONFIGS } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PaymentPageProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTier: SubscriptionTier;
  billingCycle: BillingCycle;
  autoRenew: boolean;
  savePayment: boolean;
}

type PaymentMethod = 'card' | 'bank' | 'opay' | 'apple_pay';

const formatNGN = (amount: number) => `₦${amount.toLocaleString()}`;

export const PaymentPage = ({ isOpen, onClose, selectedTier, billingCycle, autoRenew, savePayment }: PaymentPageProps) => {
  const { subscribe } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [promoCode, setPromoCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState<{ tier: string; free: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step] = useState<'method' | 'details'>('method');

  const activeTier = promoApplied && promoDiscount?.tier ? (promoDiscount.tier as SubscriptionTier) : selectedTier;
  const config = TIER_CONFIGS[activeTier];
  const price = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
  const finalPrice = promoApplied && promoDiscount?.free ? 0 : price;
  const tierSwitched = promoApplied && promoDiscount?.tier && promoDiscount.tier !== selectedTier;

  const handleRedeemCode = async () => {
    if (!promoCode.trim() || !user) return;
    setIsRedeeming(true);
    try {
      // Validate promo code via secure edge function
      const { data, error } = await supabase.functions.invoke('redeem-promo', {
        body: { code: promoCode.trim().toUpperCase(), action: 'validate' },
      });

      if (error || data?.error) {
        toast({ title: data?.error || 'Invalid promo code', variant: 'destructive' });
        return;
      }

      setPromoApplied(true);
      setPromoDiscount({ tier: data.tier, free: true });
      toast({ title: '🎉 Promo code applied!', description: `Free ${TIER_CONFIGS[data.tier as SubscriptionTier]?.name || data.tier} plan for ${data.duration_days} days!` });
    } catch {
      toast({ title: 'Failed to validate code', variant: 'destructive' });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    try {
      const tierToSubscribe = promoDiscount?.tier as SubscriptionTier || selectedTier;

      if (promoApplied && promoDiscount) {
        // Atomically redeem the promo code via secure edge function
        const { data, error } = await supabase.functions.invoke('redeem-promo', {
          body: { code: promoCode.trim().toUpperCase(), action: 'redeem' },
        });

        if (error || data?.error) {
          toast({ title: data?.error || 'Promo code is no longer valid', variant: 'destructive' });
          setPromoApplied(false);
          setPromoDiscount(null);
          setIsProcessing(false);
          return;
        }
      }

      await subscribe(tierToSubscribe, billingCycle, autoRenew, savePayment);

      // Subscription emails disabled for now

      toast({ title: `🎉 Subscribed to ${TIER_CONFIGS[tierToSubscribe].name}!`, description: promoApplied ? 'Promo code redeemed successfully!' : 'Your plan is now active.' });
      onClose();
    } catch {
      toast({ title: 'Payment failed', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const paymentMethods: { id: PaymentMethod; icon: React.ReactNode; label: string; desc: string }[] = [
    { id: 'card', icon: <CreditCard className="h-5 w-5" />, label: 'Card', desc: 'Visa, Mastercard, Verve' },
    { id: 'bank', icon: <Building2 className="h-5 w-5" />, label: 'Bank Transfer', desc: 'Direct bank payment' },
    { id: 'opay', icon: <Smartphone className="h-5 w-5" />, label: 'OPay', desc: 'Pay with OPay wallet' },
    { id: 'apple_pay', icon: <Smartphone className="h-5 w-5" />, label: 'Apple Pay', desc: 'Quick & secure' },
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="xai-gradient-border rounded-xl">
            <div className="xai-gradient-border-content rounded-xl bg-card p-6 max-h-[85vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div />
                <h2 className="text-lg font-display font-bold xai-gradient-text">Payment</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
              </div>

              {/* Order summary */}
              <div className="p-3 rounded-lg bg-secondary/50 border border-border mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{config.name} Plan</p>
                    <p className="text-xs text-muted-foreground">{billingCycle === 'monthly' ? 'Monthly' : 'Yearly'} billing</p>
                  </div>
                  <div className="text-right">
                    {promoApplied ? (
                      <>
                        <p className="text-sm line-through text-muted-foreground">{formatNGN(price)}</p>
                        <p className="text-lg font-bold text-green-500">FREE</p>
                      </>
                    ) : (
                      <p className="text-lg font-bold">{formatNGN(price)}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Promo Code */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1.5 block">Promo / Redeem Code</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Gift className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="XPRO-FREE-XXXXX"
                      className="pl-9 uppercase"
                      disabled={promoApplied}
                    />
                  </div>
                  <Button
                    variant={promoApplied ? 'outline' : 'xai'}
                    onClick={handleRedeemCode}
                    disabled={isRedeeming || promoApplied || !promoCode.trim()}
                    className="shrink-0"
                  >
                    {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : promoApplied ? <Check className="h-4 w-4 text-green-500" /> : 'Apply'}
                  </Button>
                </div>
                {promoApplied && (
                  <p className="text-xs text-green-500 mt-1">✓ Code applied — {TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name || 'Basic'} plan free for 30 days!</p>
                )}
                {tierSwitched && (
                  <p className="text-xs text-amber-500 mt-1">⚠ This code is for the {TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name} plan. Your subscription will be activated on that plan instead.</p>
                )}
              </div>

              {/* Payment methods disabled — redeem code only */}

              {/* Payment button — only enabled after valid promo code */}
              <Button
                variant="xai"
                className="w-full h-12"
                onClick={handlePayment}
                disabled={isProcessing || !promoApplied}
              >
                {isProcessing ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                ) : promoApplied ? (
                  `Activate ${TIER_CONFIGS[activeTier]?.name} — Free`
                ) : (
                  'Enter a redeem code to continue'
                )}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center mt-3">
                {autoRenew ? 'Auto-renewal enabled. ' : ''}
                Payments processed securely via Paystack.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
