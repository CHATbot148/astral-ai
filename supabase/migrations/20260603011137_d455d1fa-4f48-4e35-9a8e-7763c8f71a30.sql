ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_email_token TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS amount_paid_minor INTEGER,
  ADD COLUMN IF NOT EXISTS cancellation_type TEXT,
  ADD COLUMN IF NOT EXISTS access_until TIMESTAMPTZ;