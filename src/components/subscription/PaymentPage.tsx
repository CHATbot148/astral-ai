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

  const config = TIER_CONFIGS[selectedTier];
  const price = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
  const finalPrice = promoApplied && promoDiscount?.free ? 0 : price;

  const handleRedeemCode = async () => {
    if (!promoCode.trim() || !user) return;
    setIsRedeeming(true);
    try {
      const { data: code, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', promoCode.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (error || !code) {
        toast({ title: 'Invalid promo code', variant: 'destructive' });
        return;
      }

      if (code.current_uses >= code.max_uses) {
        toast({ title: 'This code has already been used', variant: 'destructive' });
        return;
      }

      if (code.expires_at && new Date(code.expires_at) < new Date()) {
        toast({ title: 'This code has expired', variant: 'destructive' });
        return;
      }

      // Check if user already redeemed this code
      const { data: existing } = await supabase
        .from('promo_code_redemptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('promo_code_id', code.id)
        .maybeSingle();

      if (existing) {
        toast({ title: 'You have already used this code', variant: 'destructive' });
        return;
      }

      setPromoApplied(true);
      setPromoDiscount({ tier: code.tier, free: true });
      toast({ title: '🎉 Promo code applied!', description: `Free ${TIER_CONFIGS[code.tier as SubscriptionTier]?.name || code.tier} plan for ${code.duration_days} days!` });
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
        // Redeem the promo code - re-validate server-side
        const { data: code } = await supabase
          .from('promo_codes')
          .select('id, current_uses, max_uses, is_active, expires_at')
          .eq('code', promoCode.trim().toUpperCase())
          .eq('is_active', true)
          .maybeSingle();

        if (!code || code.current_uses >= code.max_uses || (code.expires_at && new Date(code.expires_at) < new Date())) {
          toast({ title: 'Promo code is no longer valid', variant: 'destructive' });
          setPromoApplied(false);
          setPromoDiscount(null);
          setIsProcessing(false);
          return;
        }

        if (user) {
          // Check if already redeemed
          const { data: existing } = await supabase
            .from('promo_code_redemptions')
            .select('id')
            .eq('user_id', user.id)
            .eq('promo_code_id', code.id)
            .maybeSingle();

          if (existing) {
            toast({ title: 'You already used this code', variant: 'destructive' });
            setIsProcessing(false);
            return;
          }

          await supabase.from('promo_code_redemptions').insert({
            user_id: user.id,
            promo_code_id: code.id,
          });
        }
      }

      await subscribe(tierToSubscribe, billingCycle, autoRenew, savePayment);

      // Send subscription email notification
      try {
        await supabase.functions.invoke('subscription-email', {
          body: {
            type: 'subscription',
            userEmail: user?.email,
            userName: user?.user_metadata?.full_name || user?.email?.split('@')[0],
            tier: TIER_CONFIGS[tierToSubscribe].name,
            billingCycle,
            amount: finalPrice,
            autoRenew,
            savePayment,
          },
        });
      } catch (e) {
        console.error('Email notification failed:', e);
      }

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
                  <p className="text-xs text-green-500 mt-1">✓ Code applied — {TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name || 'Pro'} plan free for 30 days!</p>
                )}
              </div>

              {/* Payment methods disabled — redeem code only */}

              {/* Payment button */}
              <Button
                variant="xai"
                className="w-full h-12"
                onClick={handlePayment}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                ) : promoApplied ? (
                  `Activate ${TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name || selectedTier} — Free`
                ) : (
                  `Pay ${formatNGN(finalPrice)}`
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
