import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gift, Loader2, Check, Repeat, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
}

export const PaymentPage = ({ isOpen, onClose, selectedTier, billingCycle }: PaymentPageProps) => {
  const { subscribe } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();
  const [promoCode, setPromoCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [appliedTier, setAppliedTier] = useState<SubscriptionTier | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [locale, setLocale] = useState<LocaleInfo>(getCachedLocale());
  const [autoRenew, setAutoRenew] = useState(true);
  const [savePayment, setSavePayment] = useState(false);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);

  useEffect(() => { if (isOpen) detectLocale().then(setLocale); }, [isOpen]);

  const activeTier = promoApplied && appliedTier ? appliedTier : selectedTier;
  const config = TIER_CONFIGS[activeTier];
  const priceNGN = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
  const tierSwitched = promoApplied && appliedTier && appliedTier !== selectedTier;

  // Promo: validate + redeem + activate in one click
  const handleRedeemCode = async () => {
    if (!promoCode.trim() || !user) return;
    if (!agreedToPolicy) {
      toast({ title: 'Please agree to the Privacy Policy & Terms', variant: 'destructive' });
      return;
    }
    setIsRedeeming(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-promo', {
        body: { code: promoCode.trim().toUpperCase(), action: 'redeem' },
      });
      if (error || data?.error || !data?.success) {
        const msg = data?.error || (error as any)?.message || 'Invalid or already-used code';
        toast({ title: msg, variant: 'destructive' });
        return;
      }
      const tierFromCode = data.tier as SubscriptionTier;
      // All coupons grant 1 month, no auto-renew.
      await subscribe(tierFromCode, 'monthly', false, false, 30);
      setPromoApplied(true);
      setAppliedTier(tierFromCode);
      toast({ title: `🎉 ${TIER_CONFIGS[tierFromCode].name} activated for 30 days` });
      setTimeout(onClose, 900);
    } catch (e) {
      toast({ title: 'Failed to redeem code', variant: 'destructive' });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handlePaystackPay = async () => {
    if (!agreedToPolicy) {
      toast({ title: 'Please agree to the Privacy Policy & Terms', variant: 'destructive' });
      return;
    }
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
                    <p className="text-xs text-muted-foreground">{promoApplied ? 'Coupon · 30 days' : (billingCycle === 'monthly' ? 'Monthly' : 'Yearly')} billing</p>
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
                      placeholder="ASTRAZ-P-XXXXXX" className="pl-9 uppercase" disabled={promoApplied || isRedeeming} />
                  </div>
                  <Button variant={promoApplied ? 'outline' : 'xai'} onClick={handleRedeemCode}
                    disabled={isRedeeming || promoApplied || !promoCode.trim()} className="shrink-0">
                    {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> :
                      promoApplied ? <Check className="h-4 w-4 text-green-500" /> : 'Apply'}
                  </Button>
                </div>
                {promoApplied && appliedTier && (
                  <p className="text-xs text-green-500 mt-1">✓ {TIER_CONFIGS[appliedTier].name} activated free for 30 days</p>
                )}
                {tierSwitched && (
                  <p className="text-xs text-amber-500 mt-1">⚠ This code activated {TIER_CONFIGS[appliedTier!].name} instead.</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">All coupons are 30 days, single-use, and don't auto-renew.</p>
              </div>

              {/* Refund policy warning */}
              {!promoApplied && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-4">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    {billingCycle === 'monthly'
                      ? 'Full refund within 72 hours of purchase. After 72 hours, a 20% cancellation fee applies.'
                      : 'Full refund within 31 days of purchase. After 31 days, a 20% cancellation fee applies.'}
                  </p>
                </div>
              )}

              {/* Options */}
              {!promoApplied && (
                <div className="space-y-3 mb-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox checked={autoRenew} onCheckedChange={(c) => setAutoRenew(!!c)} />
                    <span className="text-sm">Auto-renew subscription</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox checked={savePayment} onCheckedChange={(c) => setSavePayment(!!c)} />
                    <span className="text-sm">Save payment method for future purchases</span>
                  </label>
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer mb-4">
                <Checkbox checked={agreedToPolicy} onCheckedChange={(c) => setAgreedToPolicy(!!c)} />
                <span className="text-sm">
                  I agree to the{' '}
                  <a href="/privacy-policy" target="_blank" className="text-xai-cyan hover:underline">
                    Privacy Policy & Terms
                  </a>
                </span>
              </label>

              {!promoApplied && (
                <Button variant="xai" className="w-full h-12" onClick={handlePaystackPay} disabled={isProcessing || !agreedToPolicy}>
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
