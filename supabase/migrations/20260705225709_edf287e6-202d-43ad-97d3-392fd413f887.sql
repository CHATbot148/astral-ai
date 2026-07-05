
-- ============================================================
-- promo_codes: remove public read access
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read active promo codes" ON public.promo_codes;
REVOKE SELECT ON public.promo_codes FROM anon;
REVOKE SELECT ON public.promo_codes FROM authenticated;
GRANT ALL ON public.promo_codes TO service_role;

-- ============================================================
-- subscriptions: only service_role can write. Add explicit deny
-- policies so a future permissive policy cannot be added by mistake.
-- ============================================================
DROP POLICY IF EXISTS "Deny user inserts on subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Deny user updates on subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Deny user deletes on subscriptions" ON public.subscriptions;

CREATE POLICY "Deny user inserts on subscriptions"
  ON public.subscriptions FOR INSERT TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "Deny user updates on subscriptions"
  ON public.subscriptions FOR UPDATE TO authenticated, anon
  USING (false);

CREATE POLICY "Deny user deletes on subscriptions"
  ON public.subscriptions FOR DELETE TO authenticated, anon
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- ============================================================
-- daily_usage: block client writes; only backend can increment.
-- ============================================================
DROP POLICY IF EXISTS "Deny user inserts on daily_usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Deny user updates on daily_usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Deny user deletes on daily_usage" ON public.daily_usage;

CREATE POLICY "Deny user inserts on daily_usage"
  ON public.daily_usage FOR INSERT TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "Deny user updates on daily_usage"
  ON public.daily_usage FOR UPDATE TO authenticated, anon
  USING (false);

CREATE POLICY "Deny user deletes on daily_usage"
  ON public.daily_usage FOR DELETE TO authenticated, anon
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.daily_usage FROM anon, authenticated;
GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

-- ============================================================
-- scheduled_notifications: block user updates to sensitive columns
-- (email + status). Replace the blanket UPDATE policy with a column-
-- level GRANT so PostgREST rejects updates to those columns.
-- ============================================================
REVOKE UPDATE ON public.scheduled_notifications FROM authenticated, anon;
GRANT UPDATE (message, scheduled_for, type, updated_at) ON public.scheduled_notifications TO authenticated;
GRANT ALL ON public.scheduled_notifications TO service_role;

-- ============================================================
-- push_subscriptions: no client-side SELECT (would expose crypto keys).
-- No SELECT policy exists today — enforce with a REVOKE + explicit deny
-- policy so future policies can't accidentally re-expose the keys.
-- ============================================================
DROP POLICY IF EXISTS "Deny client reads on push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Deny client reads on push_subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated, anon
  USING (false);

REVOKE SELECT ON public.push_subscriptions FROM authenticated, anon;
GRANT INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- ============================================================
-- user_connections: hide oauth_tokens from the client. Users can still
-- see whether a connection is enabled/metadata but never the raw tokens.
-- ============================================================
REVOKE SELECT ON public.user_connections FROM authenticated, anon;
GRANT SELECT (id, user_id, provider, enabled, metadata, created_at, updated_at)
  ON public.user_connections TO authenticated;
GRANT ALL ON public.user_connections TO service_role;

-- ============================================================
-- realtime.messages: explicit deny for Broadcast/Presence channels.
-- Postgres_changes on public.messages continues to work because it's
-- gated by source-table RLS, not realtime.messages policies.
-- ============================================================
DROP POLICY IF EXISTS "Deny broadcast/presence subscriptions" ON realtime.messages;
CREATE POLICY "Deny broadcast/presence subscriptions"
  ON realtime.messages FOR SELECT TO authenticated, anon
  USING (false);
