-- Add unique constraint on endpoint for push_subscriptions upsert
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);