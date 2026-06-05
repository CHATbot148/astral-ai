import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gift, Loader2, Check, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSubscription, SubscriptionTier, BillingCycle, TIER_CONFIGS } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectLocale, getCachedLocale, formatLocalPrice, type LocaleInfo } from '@/lib/pricing';

interface PaymentPageProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTier: SubscriptionTier;
  billingCycle: BillingCycle;
  autoRenew: boolean;
  savePayment: boolean;
}

export const PaymentPage = ({ isOpen, onClose, selectedTier, billingCycle, autoRenew }: PaymentPageProps) => {
  const { subscribe } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();
  const [promoCode, setPromoCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState<{ tier: string; free: boolean; durationDays: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [locale, setLocale] = useState<LocaleInfo>(getCachedLocale());

  useEffect(() => { if (isOpen) detectLocale().then(setLocale); }, [isOpen]);

  const activeTier = promoApplied && promoDiscount?.tier ? (promoDiscount.tier as SubscriptionTier) : selectedTier;
  const config = TIER_CONFIGS[activeTier];
  const priceNGN = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
  const tierSwitched = promoApplied && promoDiscount?.tier && promoDiscount.tier !== selectedTier;

  const handleRedeemCode = async () => {
    if (!promoCode.trim() || !user) return;
    setIsRedeeming(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-promo', {
        body: { code: promoCode.trim().toUpperCase(), action: 'validate' },
      });
      if (error || data?.error) {
        toast({ title: data?.error || 'Invalid promo code', variant: 'destructive' });
        return;
      }
      setPromoApplied(true);
      setPromoDiscount({ tier: data.tier, free: true, durationDays: data.duration_days ?? 30 });
    } catch {
      toast({ title: 'Failed to validate code', variant: 'destructive' });
    } finally { setIsRedeeming(false); }
  };

  const handlePromoActivate = async () => {
    setIsProcessing(true);
    try {
      const tierToSubscribe = promoDiscount?.tier as SubscriptionTier;
      const { data, error } = await supabase.functions.invoke('redeem-promo', {
        body: { code: promoCode.trim().toUpperCase(), action: 'redeem' },
      });
      if (error || data?.error) {
        toast({ title: data?.error || 'Promo no longer valid', variant: 'destructive' });
        setPromoApplied(false); setPromoDiscount(null); setIsProcessing(false); return;
      }
      await subscribe(tierToSubscribe, 'monthly', false, false, promoDiscount?.durationDays ?? data.duration_days ?? 30);
      toast({ title: `🎉 ${TIER_CONFIGS[tierToSubscribe].name} activated!` });
      onClose();
    } catch {
      toast({ title: 'Activation failed', variant: 'destructive' });
    } finally { setIsProcessing(false); }
  };

  const handlePaystackPay = async () => {
    setIsProcessing(true);
    try {
      const callbackUrl = `${window.location.origin}/`;
      const { data, error } = await supabase.functions.invoke('paystack-initialize', {
        body: { tier: selectedTier, cycle: billingCycle, autoRenew, callbackUrl },
      });
      if (error || data?.error || !data?.authorization_url) {
        toast({ title: data?.error || 'Could not start payment', variant: 'destructive' });
        setIsProcessing(false); return;
      }
      window.location.href = data.authorization_url;
    } catch {
      toast({ title: 'Payment init failed', variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative z-10 w-full max-w-md">
          <div className="xai-gradient-border rounded-xl">
            <div className="xai-gradient-border-content rounded-xl bg-card p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div />
                <h2 className="text-lg font-display font-bold xai-gradient-text">Payment</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
              </div>

              <div className="p-3 rounded-lg bg-secondary/50 border border-border mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{config.name} Plan</p>
                    <p className="text-xs text-muted-foreground">{billingCycle === 'monthly' ? 'Monthly' : 'Yearly'} billing</p>
                  </div>
                  <div className="text-right">
                    {promoApplied ? (
                      <>
                        <p className="text-sm line-through text-muted-foreground">{formatLocalPrice(priceNGN, locale.currency)}</p>
                        <p className="text-lg font-bold text-green-500">FREE</p>
                      </>
                    ) : (
                      <p className="text-lg font-bold">{formatLocalPrice(priceNGN, locale.currency)}</p>
                    )}
                  </div>
                </div>
                {autoRenew && !promoApplied && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-xai-cyan">
                    <Repeat className="h-3 w-3" />
                    <span>Auto-renews every {billingCycle === 'monthly' ? 'month' : 'year'} until you cancel</span>
                  </div>
                )}
              </div>

              {/* Promo Code */}
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1.5 block">Promo / Redeem Code (optional)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Gift className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="ASTRAZ-P-XXXXXX" className="pl-9 uppercase" disabled={promoApplied} />
                  </div>
                  <Button variant={promoApplied ? 'outline' : 'xai'} onClick={handleRedeemCode}
                    disabled={isRedeeming || promoApplied || !promoCode.trim()} className="shrink-0">
                    {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> :
                      promoApplied ? <Check className="h-4 w-4 text-green-500" /> : 'Apply'}
                  </Button>
                </div>
                {promoApplied && (
                  <p className="text-xs text-green-500 mt-1">✓ {TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name} free for {promoDiscount?.durationDays ?? 30} days</p>
                )}
                {tierSwitched && (
                  <p className="text-xs text-amber-500 mt-1">⚠ This code is for the {TIER_CONFIGS[promoDiscount?.tier as SubscriptionTier]?.name} plan instead.</p>
                )}
              </div>

              {promoApplied ? (
                <Button variant="xai" className="w-full h-12" onClick={handlePromoActivate} disabled={isProcessing}>
                  {isProcessing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Activating…</> :
                    `Activate ${TIER_CONFIGS[activeTier]?.name} — Free`}
                </Button>
              ) : (
                <Button variant="xai" className="w-full h-12" onClick={handlePaystackPay} disabled={isProcessing}>
                  {isProcessing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirecting…</> :
                    `Pay ${formatLocalPrice(priceNGN, locale.currency)} with Paystack`}
                </Button>
              )}

              <p className="text-[10px] text-muted-foreground text-center mt-3">
                Payments processed securely via Paystack. Cards, bank transfer, USSD & mobile money supported.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
