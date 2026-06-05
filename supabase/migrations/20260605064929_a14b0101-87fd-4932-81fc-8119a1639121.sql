
CREATE TABLE IF NOT EXISTS public.subscription_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_type text NOT NULL,
  period_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email_type, period_key)
);
GRANT SELECT ON public.subscription_email_log TO authenticated;
GRANT ALL ON public.subscription_email_log TO service_role;
ALTER TABLE public.subscription_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own sub email log" ON public.subscription_email_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS source text;
