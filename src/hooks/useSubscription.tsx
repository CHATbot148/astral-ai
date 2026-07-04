import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'ultimate';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'pending';

export interface TierConfig {
  name: string;
  price: { monthly: number; yearly: number };
  limits: {
    imagesPerDay: number;
    videosPerDay: number;
    imageQuality: 'low' | 'medium' | 'high' | 'any';
    videoQuality: 'none' | 'low' | 'high' | 'any';
    watermark: boolean;
    videoWatermark: boolean;
    anyModel: boolean;
  };
}

export const TIER_CONFIGS: Record<SubscriptionTier, TierConfig> = {
  free: {
    name: 'Free',
    price: { monthly: 0, yearly: 0 },
    limits: {
      imagesPerDay: 5,
      videosPerDay: 0,
      imageQuality: 'low',
      videoQuality: 'none',
      watermark: true,
      videoWatermark: true,
      anyModel: false,
    },
  },
  basic: {
    name: 'Basic',
    price: { monthly: 5000, yearly: 42000 },
    limits: {
      imagesPerDay: 10,
      videosPerDay: 2,
      imageQuality: 'medium',
      videoQuality: 'low',
      watermark: true,
      videoWatermark: true,
      anyModel: false,
    },
  },
  pro: {
    name: 'Pro',
    price: { monthly: 20000, yearly: 168000 },
    limits: {
      imagesPerDay: 25,
      videosPerDay: 8,
      imageQuality: 'high',
      videoQuality: 'high',
      watermark: true,
      videoWatermark: false,
      anyModel: false,
    },
  },
  ultimate: {
    name: 'Ultimate',
    price: { monthly: 50000, yearly: 420000 },
    limits: {
      imagesPerDay: Infinity,
      videosPerDay: Infinity,
      imageQuality: 'any',
      videoQuality: 'any',
      watermark: false,
      videoWatermark: false,
      anyModel: true,
    },
  },
};

export interface Subscription {
  id: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle | null;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  auto_renew: boolean;
  save_payment_method: boolean;
  agreed_to_privacy_policy: boolean;
  cancellation_type?: string | null;
  access_until?: string | null;
  paystack_subscription_code?: string | null;
}

// Subscription is "effectively active" if status=active OR (cancelled with access until future)
const isAccessActive = (sub: Subscription | null): boolean => {
  if (!sub) return false;
  const accessUntil = sub.access_until || sub.expires_at;
  if (sub.status === 'active') {
    return !accessUntil || new Date(accessUntil).getTime() > Date.now();
  }
  if (sub.cancellation_type === 'end_of_period' && sub.access_until) {
    return new Date(sub.access_until).getTime() > Date.now();
  }
  return false;
};



export interface DailyUsage {
  images_generated: number;
  videos_generated: number;
}

interface SubscriptionContextType {
  subscription: Subscription | null;
  dailyUsage: DailyUsage;
  tier: SubscriptionTier;
  tierConfig: TierConfig;
  loading: boolean;
  canGenerateImage: boolean;
  canGenerateVideo: boolean;
  remainingImages: number;
  remainingVideos: number;
  subscribe: (tier: SubscriptionTier, cycle: BillingCycle, autoRenew: boolean, savePayment: boolean, durationDays?: number) => Promise<void>;
  cancelSubscription: () => Promise<{ refundEligible: boolean; fee: number }>;
  refreshUsage: () => Promise<void>;
  incrementImageUsage: () => Promise<void>;
  incrementVideoUsage: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>({ images_generated: 0, videos_generated: 0 });
  const [loading, setLoading] = useState(true);

  const tier: SubscriptionTier = isAccessActive(subscription) ? (subscription!.tier as SubscriptionTier) : 'free';
  const tierConfig = TIER_CONFIGS[tier];

  const remainingImages = Math.max(0, tierConfig.limits.imagesPerDay - dailyUsage.images_generated);
  const remainingVideos = Math.max(0, tierConfig.limits.videosPerDay - dailyUsage.videos_generated);
  const canGenerateImage = remainingImages > 0;
  const canGenerateVideo = tierConfig.limits.videosPerDay > 0 && remainingVideos > 0;

  const fetchSubscription = useCallback(async () => {
    if (!user) { setSubscription(null); setLoading(false); return; }
    try {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      const sub = data as Subscription | null;
      const accessUntil = sub?.access_until || sub?.expires_at;
      if (sub?.status === 'active' && accessUntil && new Date(accessUntil).getTime() <= Date.now()) {
        setSubscription({ ...sub, status: 'expired' });
        void supabase.functions.invoke('check-subscription-renewals', { body: {} }).catch(() => {});
      } else {
        setSubscription(sub);
      }
    } catch (e) {
      console.error('Failed to fetch subscription:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchDailyUsage = useCallback(async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const { data } = await supabase
        .from('daily_usage')
        .select('images_generated, videos_generated')
        .eq('user_id', user.id)
        .eq('usage_date', today)
        .maybeSingle();
      setDailyUsage(data || { images_generated: 0, videos_generated: 0 });
    } catch (e) {
      console.error('Failed to fetch daily usage:', e);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscription();
    fetchDailyUsage();
  }, [fetchSubscription, fetchDailyUsage]);

  const refreshUsage = useCallback(async () => {
    await fetchDailyUsage();
  }, [fetchDailyUsage]);

  const incrementImageUsage = async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase
      .from('daily_usage')
      .select('id, images_generated')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('daily_usage')
        .update({ images_generated: existing.images_generated + 1 })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('daily_usage')
        .insert({ user_id: user.id, usage_date: today, images_generated: 1, videos_generated: 0 });
    }
    await fetchDailyUsage();
  };

  const incrementVideoUsage = async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase
      .from('daily_usage')
      .select('id, videos_generated')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('daily_usage')
        .update({ videos_generated: existing.videos_generated + 1 })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('daily_usage')
        .insert({ user_id: user.id, usage_date: today, images_generated: 0, videos_generated: 1 });
    }
    await fetchDailyUsage();
  };

  const subscribe = async (newTier: SubscriptionTier, cycle: BillingCycle, autoRenew: boolean, savePayment: boolean, durationDays?: number) => {
    if (!user) return;
    const now = new Date();
    const expiresAt = new Date(now);
    if (durationDays) {
      expiresAt.setDate(expiresAt.getDate() + durationDays);
    } else if (cycle === 'monthly') {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }

    const subData = {
      user_id: user.id,
      tier: newTier,
      billing_cycle: cycle,
      status: 'active' as const,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      auto_renew: autoRenew,
      save_payment_method: savePayment,
      agreed_to_privacy_policy: true,
      privacy_policy_agreed_at: now.toISOString(),
    };

    if (subscription) {
      await supabase.from('subscriptions').update(subData).eq('user_id', user.id);
    } else {
      await supabase.from('subscriptions').insert(subData);
    }
    await fetchSubscription();
  };

  const cancelSubscription = async () => {
    if (!subscription || !user) return { refundEligible: false, fee: 0 };

    const startDate = new Date(subscription.started_at);
    const now = new Date();
    const daysSinceStart = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

    const isMonthly = subscription.billing_cycle === 'monthly';
    const freeWindow = isMonthly ? 3 : 31; // 72h = 3 days, 31 days
    const refundEligible = daysSinceStart <= freeWindow;

    const price = TIER_CONFIGS[subscription.tier as SubscriptionTier]?.price;
    const paidAmount = isMonthly ? price?.monthly || 0 : price?.yearly || 0;
    const fee = refundEligible ? 0 : paidAmount * 0.2;

    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        auto_renew: false,
      })
      .eq('user_id', user.id);

    await fetchSubscription();
    return { refundEligible, fee };
  };

  return (
    <SubscriptionContext.Provider value={{
      subscription,
      dailyUsage,
      tier,
      tierConfig,
      loading,
      canGenerateImage,
      canGenerateVideo,
      remainingImages,
      remainingVideos,
      subscribe,
      cancelSubscription,
      refreshUsage,
      incrementImageUsage,
      incrementVideoUsage,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
};

const defaultContext: SubscriptionContextType = {
  subscription: null,
  dailyUsage: { images_generated: 0, videos_generated: 0 },
  tier: 'free',
  tierConfig: TIER_CONFIGS['free'],
  loading: true,
  canGenerateImage: false,
  canGenerateVideo: false,
  remainingImages: 0,
  remainingVideos: 0,
  subscribe: async () => {},
  cancelSubscription: async () => ({ refundEligible: false, fee: 0 }),
  refreshUsage: async () => {},
  incrementImageUsage: async () => {},
  incrementVideoUsage: async () => {},
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  return context ?? defaultContext;
};
