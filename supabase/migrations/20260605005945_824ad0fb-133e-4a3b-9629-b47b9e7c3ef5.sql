ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pro_messages_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pro_reset_at timestamptz;