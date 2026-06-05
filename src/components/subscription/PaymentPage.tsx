import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Apple,
  ArrowLeft,
  Check,
  CreditCard,
  Gift,
  Landmark,
  Loader2,
  Repeat,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useSubscription, SubscriptionTier, BillingCycle, TIER_CONFIGS } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { detectLocale, getCachedLocale, formatLocalPrice, type LocaleInfo } from '@/lib/pricing';

type PaymentMethod = 'coupon' | 'card' | 'apple_pay' | 'bank_transfer';
type PaymentReason = 'image_limit' | 'video_limit' | 'general';

interface PaymentPageProps {
  selectedTier: SubscriptionTier;
  billingCycle: BillingCycle;
  reason?: PaymentReason;
}

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  label: string;
  description: string;
  icon: typeof Gift;
}> = [
  { id: 'card', label: 'Card', description: 'Enter card details', icon: CreditCard },
  { id: 'apple_pay', label: 'Apple Pay', description: 'Fast wallet checkout', icon: Apple },
  { id: 'bank_transfer', label: 'Bank Transfer', description: 'Supported regions only', icon: Landmark },
  { id: 'coupon', label: 'Coupon', description: 'Redeem 30-day access', icon: Gift },
];

const getCardBrand = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^(5060|5061|5078|5079|6500)/.test(digits)) return 'Verve';
  return 'Card';
};

const formatCardNumber = (value: string, brand: string) => {
  const digits = value.replace(/\D/g, '').slice(0, brand === 'American Express' ? 15 : 19);
  if (brand === 'American Express') {
    const parts = [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean);
    return parts.join(' ');
  }
  return digits.match(/.{1,4}/g)?.join(' ') ?? digits;
};

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

const isLuhnValid = (cardNumber: string) => {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
};

const isExpiryValid = (value: string) => {
  const [monthRaw, yearRaw] = value.split('/');
  if (!monthRaw || !yearRaw || yearRaw.length !== 2) return false;
  const month = Number(monthRaw);
  const year = Number(`20${yearRaw}`);
  if (month < 1 || month > 12) return false;

  const now = new Date();
  const expiry = new Date(year, month, 0, 23, 59, 59, 999);
  return expiry >= now;
};

export const PaymentPage = ({ selectedTier, billingCycle, reason = 'general' }: PaymentPageProps) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useSubscription();
  const { user } = useAuth();
  const { toast } = useToast();

  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const [appliedTier, setAppliedTier] = useState<SubscriptionTier | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [locale, setLocale] = useState<LocaleInfo>(getCachedLocale());
  const [autoRenew, setAutoRenew] = useState(true);
  const [savePayment, setSavePayment] = useState(false);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [supportsApplePay, setSupportsApplePay] = useState(false);

  useEffect(() => {
    detectLocale().then(setLocale);
    try {
      const applePayAvailable =
        typeof window !== 'undefined' &&
        'ApplePaySession' in window &&
        typeof (window as Window & { ApplePaySession?: { canMakePayments?: () => boolean } }).ApplePaySession?.canMakePayments === 'function' &&
        !!(window as Window & { ApplePaySession?: { canMakePayments?: () => boolean } }).ApplePaySession?.canMakePayments?.();
      setSupportsApplePay(applePayAvailable);
    } catch {
      setSupportsApplePay(false);
    }
  }, []);

  const activeTier = promoApplied && appliedTier ? appliedTier : selectedTier;
  const config = TIER_CONFIGS[activeTier];
  const priceNGN = billingCycle === 'monthly' ? config.price.monthly : config.price.yearly;
  const tierSwitched = promoApplied && appliedTier && appliedTier !== selectedTier;
  const cardBrand = useMemo(() => getCardBrand(cardNumber), [cardNumber]);
  const cvvMaxLength = cardBrand === 'American Express' ? 4 : 3;
  const supportsBankTransfer = locale.country === 'NG';

  useEffect(() => {
    if (!user || isVerifying || paymentComplete) return;

    const reference = searchParams.get('reference') || searchParams.get('trxref');
    if (!reference) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('reference');
    nextParams.delete('trxref');
    setSearchParams(nextParams, { replace: true });

    setIsVerifying(true);
    supabase.functions.invoke('paystack-verify', { body: { reference } }).then(({ data, error }) => {
      if (error || data?.error) {
        toast({ title: data?.error || 'Payment verification failed', variant: 'destructive' });
      } else {
        setPaymentComplete(true);
        toast({ title: 'Subscription activated', description: 'Your plan is now active.' });
      }
    }).finally(() => setIsVerifying(false));
  }, [paymentComplete, searchParams, setSearchParams, toast, user, isVerifying]);

  const getFunctionErrorMessage = async (error: unknown, fallback: string) => {
    if (!(error instanceof Error) || !("context" in error)) return error instanceof Error ? error.message : fallback;

    try {
      const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (context?.json) {
        const body = await context.json();
        if (body?.error) return body.error;
      }
    } catch {
      // ignore body parsing failures
    }

    return error.message || fallback;
  };

  const validateCardFields = () => {
    if (!cardholderName.trim()) return 'Enter the name on the card';
    if (!isLuhnValid(cardNumber)) return 'Enter a valid card number';
    if (!isExpiryValid(expiry)) return 'Enter a valid expiry date';
    if (cvv.replace(/\D/g, '').length !== cvvMaxLength) return `Enter a valid ${cvvMaxLength}-digit security code`;
    return null;
  };

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
        const msg = data?.error || await getFunctionErrorMessage(error, 'Invalid or already-used code');
        toast({ title: msg, variant: 'destructive' });
        return;
      }

      const tierFromCode = data.tier as SubscriptionTier;
      await subscribe(tierFromCode, 'monthly', false, false, data.duration_days ?? 30);
      setPromoApplied(true);
      setAppliedTier(tierFromCode);
      setPaymentComplete(true);
      toast({ title: `${TIER_CONFIGS[tierFromCode].name} activated for ${data.duration_days ?? 30} days` });
    } catch (error) {
      toast({ title: await getFunctionErrorMessage(error, 'Failed to redeem code'), variant: 'destructive' });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handlePaystackPay = async (method: Exclude<PaymentMethod, 'coupon'>) => {
    if (!agreedToPolicy) {
      toast({ title: 'Please agree to the Privacy Policy & Terms', variant: 'destructive' });
      return;
    }

    if (method === 'card') {
      const cardError = validateCardFields();
      if (cardError) {
        toast({ title: cardError, variant: 'destructive' });
        return;
      }
    }

    setIsProcessing(true);
    try {
      const callbackParams = new URLSearchParams({
        tier: selectedTier,
        cycle: billingCycle,
        reason,
      });

      const callbackUrl = `${window.location.origin}/payment?${callbackParams.toString()}`;
      const { data, error } = await supabase.functions.invoke('paystack-initialize', {
        body: {
          tier: selectedTier,
          cycle: billingCycle,
          autoRenew,
          callbackUrl,
          channel: method,
          savePayment,
        },
      });

      if (error || data?.error || !data?.authorization_url) {
        toast({ title: data?.error || 'Could not start payment', variant: 'destructive' });
        setIsProcessing(false);
        return;
      }

      window.location.href = data.authorization_url;
    } catch (error) {
      toast({ title: await getFunctionErrorMessage(error, 'Payment init failed'), variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  const reasonText =
    reason === 'image_limit'
      ? 'Unlock more image generations and higher-quality outputs.'
      : reason === 'video_limit'
        ? 'Unlock more video generations and longer creative runs.'
        : 'Choose how you want to activate your Astraz plan.';

  const planFeatures = [
    'Astraz Pro model unlocked',
    `${config.limits.imagesPerDay === Infinity ? 'Unlimited' : config.limits.imagesPerDay} image generations each day`,
    `${config.limits.videosPerDay === Infinity ? 'Unlimited' : config.limits.videosPerDay} video generations each day`,
    config.limits.anyModel ? 'Access to any Leonardo AI model' : 'Optimized generation model access',
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="aurora-bg" />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Secure Checkout</p>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-73px)] max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:px-8 lg:py-10">
        <section className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Payment</p>
            <h1 className="font-display text-3xl font-bold xai-gradient-text">Checkout</h1>
            <p className="mt-3 text-sm text-muted-foreground">{reasonText}</p>

            <div className="mt-5 rounded-lg border border-border bg-secondary/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold">{config.name} Plan</p>
                  <p className="text-xs text-muted-foreground">
                    {promoApplied ? 'Coupon · 30 days access' : billingCycle === 'monthly' ? 'Monthly billing' : 'Yearly billing'}
                  </p>
                </div>
                <div className="text-right">
                  {promoApplied ? (
                    <>
                      <p className="text-xs text-muted-foreground line-through">{formatLocalPrice(priceNGN, locale.currency)}</p>
                      <p className="text-2xl font-bold text-xai-cyan">FREE</p>
                    </>
                  ) : (
                    <p className="text-2xl font-bold">{formatLocalPrice(priceNGN, locale.currency)}</p>
                  )}
                </div>
              </div>

              {autoRenew && !promoApplied && (
                <div className="mt-3 flex items-center gap-2 text-xs text-xai-cyan">
                  <Repeat className="h-3.5 w-3.5" />
                  <span>Auto-renews every {billingCycle === 'monthly' ? 'month' : 'year'} until you cancel</span>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              {planFeatures.map((feature) => (
                <div key={feature} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-xai-cyan" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {(paymentComplete || isVerifying) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-xai-cyan/40 bg-xai-cyan/10 p-4"
            >
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-xai-cyan" />
                <div>
                  <p className="font-medium text-foreground">
                    {isVerifying ? 'Finalizing your payment…' : 'Your subscription is active'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isVerifying
                      ? 'We are confirming the payment with the processor.'
                      : 'Your plan has been activated successfully. You can go back to chat any time.'}
                  </p>
                  {!isVerifying && (
                    <Button variant="xai" className="mt-3" onClick={() => navigate('/')}>
                      Return to Astraz
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </section>

        <section className="space-y-5">
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                const isActive = paymentMethod === method.id;
                const disabled =
                  (method.id === 'apple_pay' && !supportsApplePay) ||
                  (method.id === 'bank_transfer' && !supportsBankTransfer);

                return (
                  <button
                    key={method.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPaymentMethod(method.id)}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      isActive
                        ? 'border-xai-cyan bg-xai-cyan/10'
                        : 'border-border bg-secondary/20 hover:border-xai-cyan/40 hover:bg-secondary/40'
                    } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <Icon className={`mb-3 h-5 w-5 ${isActive ? 'text-xai-cyan' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-foreground">{method.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{method.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {paymentMethod === 'coupon' && (
            <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-start gap-3">
                <Gift className="mt-0.5 h-5 w-5 text-xai-cyan" />
                <div>
                  <h2 className="font-semibold">Redeem coupon</h2>
                  <p className="text-sm text-muted-foreground">Apply a single-use code to activate a 30-day non-renewing plan instantly.</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Gift className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={promoCode}
                    onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                    placeholder="ASTRAZ-P-XXXXXX"
                    className="pl-9 uppercase"
                    disabled={promoApplied || isRedeeming}
                  />
                </div>
                <Button
                  variant="xai"
                  onClick={handleRedeemCode}
                  disabled={isRedeeming || promoApplied || !promoCode.trim()}
                  className="sm:min-w-32"
                >
                  {isRedeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : promoApplied ? 'Applied' : 'Apply code'}
                </Button>
              </div>

              {promoApplied && appliedTier && (
                <p className="mt-3 text-sm text-xai-cyan">{TIER_CONFIGS[appliedTier].name} has been activated for 30 days.</p>
              )}
              {tierSwitched && (
                <p className="mt-2 text-xs text-muted-foreground">This code activates {TIER_CONFIGS[appliedTier!].name} instead of the selected plan.</p>
              )}
            </div>
          )}

          {paymentMethod === 'card' && (
            <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Pay with card</h2>
                  <p className="text-sm text-muted-foreground">Card formatting and brand detection are handled here before secure confirmation.</p>
                </div>
                <div className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
                  {cardBrand}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-muted-foreground">Name on card</label>
                  <Input value={cardholderName} onChange={(event) => setCardholderName(event.target.value)} placeholder="Astrid Johnson" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-muted-foreground">Card number</label>
                  <Input
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(event) => {
                      const nextBrand = getCardBrand(event.target.value);
                      setCardNumber(formatCardNumber(event.target.value, nextBrand));
                    }}
                    placeholder="1234 5678 9012 3456"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-muted-foreground">Expiry</label>
                  <Input
                    inputMode="numeric"
                    value={expiry}
                    onChange={(event) => setExpiry(formatExpiry(event.target.value))}
                    placeholder="MM/YY"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-muted-foreground">Security code</label>
                  <Input
                    inputMode="numeric"
                    value={cvv}
                    onChange={(event) => setCvv(event.target.value.replace(/\D/g, '').slice(0, cvvMaxLength))}
                    placeholder={cardBrand === 'American Express' ? '4 digits' : '3 digits'}
                  />
                </div>
              </div>

              <p className="mt-4 text-xs text-muted-foreground">After you confirm, the payment processor finishes the secure authorization for this card.</p>
            </div>
          )}

          {paymentMethod === 'apple_pay' && (
            <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-start gap-3">
                <Apple className="mt-0.5 h-5 w-5 text-xai-cyan" />
                <div>
                  <h2 className="font-semibold">Apple Pay</h2>
                  <p className="text-sm text-muted-foreground">
                    {supportsApplePay
                      ? 'Apple Pay is available on this device and domain.'
                      : 'Apple Pay is only shown on supported Apple devices and browsers.'}
                  </p>
                </div>
              </div>
              {!supportsApplePay && (
                <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                  Open this page on Safari with Apple Pay enabled to continue with this method.
                </div>
              )}
            </div>
          )}

          {paymentMethod === 'bank_transfer' && (
            <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-start gap-3">
                <Landmark className="mt-0.5 h-5 w-5 text-xai-cyan" />
                <div>
                  <h2 className="font-semibold">Bank transfer</h2>
                  <p className="text-sm text-muted-foreground">
                    {supportsBankTransfer
                      ? 'Bank transfer is available for your current region.'
                      : 'Bank transfer appears only in regions currently supported by Paystack.'}
                  </p>
                </div>
              </div>
              {!supportsBankTransfer && (
                <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                  Switch to a supported region or use card / coupon on this device.
                </div>
              )}
            </div>
          )}

          {!promoApplied && (
            <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <Checkbox checked={autoRenew} onCheckedChange={(checked) => setAutoRenew(!!checked)} />
                  <span className="text-sm">Auto-renew subscription</span>
                </label>

                {paymentMethod === 'card' && (
                  <label className="flex cursor-pointer items-center gap-3">
                    <Checkbox checked={savePayment} onCheckedChange={(checked) => setSavePayment(!!checked)} />
                    <span className="text-sm">Save payment method for future purchases</span>
                  </label>
                )}

                <label className="flex cursor-pointer items-center gap-3">
                  <Checkbox checked={agreedToPolicy} onCheckedChange={(checked) => setAgreedToPolicy(!!checked)} />
                  <span className="text-sm">
                    I agree to the{' '}
                    <a href="/privacy-policy" target="_blank" rel="noreferrer" className="text-xai-cyan hover:underline">
                      Privacy Policy & Terms
                    </a>
                  </span>
                </label>
              </div>

              <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 text-xai-cyan" />
                  <p>
                    {billingCycle === 'monthly'
                      ? 'Monthly plans are fully refundable within 72 hours. After that, a 20% cancellation fee applies.'
                      : 'Yearly plans are fully refundable within 31 days. After that, a 20% cancellation fee applies.'}
                  </p>
                </div>
              </div>

              {paymentMethod !== 'coupon' && (
                <Button
                  variant="xai"
                  className="mt-5 h-12 w-full"
                  disabled={isProcessing || isVerifying || !agreedToPolicy || paymentComplete || (paymentMethod === 'apple_pay' && !supportsApplePay) || (paymentMethod === 'bank_transfer' && !supportsBankTransfer)}
                  onClick={() => handlePaystackPay(paymentMethod)}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    `Continue with ${paymentMethod === 'apple_pay' ? 'Apple Pay' : paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'Card'} · ${formatLocalPrice(priceNGN, locale.currency)}`
                  )}
                </Button>
              )}

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Payments are processed securely through Paystack.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
