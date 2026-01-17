-- Add push notification preference to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT false;

-- Table to store scheduled reminders/notifications
CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  conversation_id uuid NULL,
  type text NOT NULL DEFAULT 'reminder',
  status text NOT NULL DEFAULT 'pending',
  email text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user_id ON public.scheduled_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due ON public.scheduled_notifications(status, scheduled_for);

ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='scheduled_notifications' AND policyname='Users can view their own scheduled notifications'
  ) THEN
    CREATE POLICY "Users can view their own scheduled notifications"
    ON public.scheduled_notifications
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='scheduled_notifications' AND policyname='Users can create their own scheduled notifications'
  ) THEN
    CREATE POLICY "Users can create their own scheduled notifications"
    ON public.scheduled_notifications
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='scheduled_notifications' AND policyname='Users can update their own scheduled notifications'
  ) THEN
    CREATE POLICY "Users can update their own scheduled notifications"
    ON public.scheduled_notifications
    FOR UPDATE
    USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='scheduled_notifications' AND policyname='Users can delete their own scheduled notifications'
  ) THEN
    CREATE POLICY "Users can delete their own scheduled notifications"
    ON public.scheduled_notifications
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END$$;

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_scheduled_notifications_updated_at ON public.scheduled_notifications;
CREATE TRIGGER update_scheduled_notifications_updated_at
BEFORE UPDATE ON public.scheduled_notifications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();