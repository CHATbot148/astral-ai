-- Email OTPs should not be readable/writable directly by clients.
-- Add explicit "deny all" policies to satisfy linter while keeping table locked down.
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='email_otps' AND policyname='Deny all reads'
  ) THEN
    CREATE POLICY "Deny all reads" ON public.email_otps
    FOR SELECT USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='email_otps' AND policyname='Deny all inserts'
  ) THEN
    CREATE POLICY "Deny all inserts" ON public.email_otps
    FOR INSERT WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='email_otps' AND policyname='Deny all updates'
  ) THEN
    CREATE POLICY "Deny all updates" ON public.email_otps
    FOR UPDATE USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='email_otps' AND policyname='Deny all deletes'
  ) THEN
    CREATE POLICY "Deny all deletes" ON public.email_otps
    FOR DELETE USING (false);
  END IF;
END$$;