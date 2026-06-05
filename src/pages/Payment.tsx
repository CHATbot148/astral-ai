import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { PaymentPage } from '@/components/subscription/PaymentPage';
import type { BillingCycle, SubscriptionTier } from '@/hooks/useSubscription';

const TIERS: SubscriptionTier[] = ['basic', 'pro', 'ultimate'];
const CYCLES: BillingCycle[] = ['monthly', 'yearly'];
const REASONS = ['general', 'image_limit', 'video_limit'] as const;

const Payment = () => {
  const [searchParams] = useSearchParams();

  const selectedTier = useMemo<SubscriptionTier>(() => {
    const tier = searchParams.get('tier') as SubscriptionTier | null;
    return tier && TIERS.includes(tier) ? tier : 'pro';
  }, [searchParams]);

  const billingCycle = useMemo<BillingCycle>(() => {
    const cycle = searchParams.get('cycle') as BillingCycle | null;
    return cycle && CYCLES.includes(cycle) ? cycle : 'monthly';
  }, [searchParams]);

  const reason = useMemo<'general' | 'image_limit' | 'video_limit'>(() => {
    const rawReason = searchParams.get('reason');
    return REASONS.includes(rawReason as (typeof REASONS)[number]) ? (rawReason as 'general' | 'image_limit' | 'video_limit') : 'general';
  }, [searchParams]);

  return (
    <>
      <Helmet>
        <title>Astraz Payment</title>
        <meta name="description" content="Complete your Astraz subscription payment with card, Apple Pay, bank transfer, or coupon redemption." />
        <link rel="canonical" href="https://astraz.online/payment" />
      </Helmet>
      <PaymentPage selectedTier={selectedTier} billingCycle={billingCycle} reason={reason} />
    </>
  );
};

export default Payment;