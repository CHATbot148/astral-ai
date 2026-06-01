
CREATE TABLE public.user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  oauth_tokens jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_connections TO authenticated;
GRANT ALL ON public.user_connections TO service_role;

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own connections" ON public.user_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own connections" ON public.user_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own connections" ON public.user_connections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own connections" ON public.user_connections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER user_connections_updated_at
  BEFORE UPDATE ON public.user_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
