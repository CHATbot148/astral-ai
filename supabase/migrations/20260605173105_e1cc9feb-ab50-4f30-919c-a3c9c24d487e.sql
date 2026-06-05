
-- 1) daily_usage
DROP POLICY IF EXISTS "Users can insert their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can update their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can insert own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can update own usage" ON public.daily_usage;
REVOKE INSERT, UPDATE, DELETE ON public.daily_usage FROM authenticated;
GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

-- 2) subscriptions
DROP POLICY IF EXISTS "Users can insert their own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- 3) promo_codes
DROP POLICY IF EXISTS "Anyone can view active promo codes" ON public.promo_codes;
DROP POLICY IF EXISTS "Public can view active promo codes" ON public.promo_codes;
DROP POLICY IF EXISTS "Active promo codes are viewable" ON public.promo_codes;
REVOKE SELECT ON public.promo_codes FROM anon;
REVOKE SELECT ON public.promo_codes FROM authenticated;
GRANT SELECT ON public.promo_codes TO service_role;

-- 4) push_subscriptions
DROP POLICY IF EXISTS "Users can view their own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can view own push subscriptions" ON public.push_subscriptions;
REVOKE SELECT ON public.push_subscriptions FROM authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- 5) user_connections public view
CREATE OR REPLACE VIEW public.user_connections_public
WITH (security_invoker = on) AS
SELECT id, user_id, provider, created_at, updated_at,
       (oauth_tokens IS NOT NULL) AS is_connected
FROM public.user_connections;
GRANT SELECT ON public.user_connections_public TO authenticated;
DROP POLICY IF EXISTS "Users can view their own connections" ON public.user_connections;
DROP POLICY IF EXISTS "Users can view own connections" ON public.user_connections;
REVOKE SELECT ON public.user_connections FROM authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.user_connections TO authenticated;
GRANT ALL ON public.user_connections TO service_role;

-- 6) scheduled_notifications: client can edit message/scheduled_for/type but never status
REVOKE UPDATE ON public.scheduled_notifications FROM authenticated;
GRANT UPDATE (message, scheduled_for, type, conversation_id, email) ON public.scheduled_notifications TO authenticated;
GRANT ALL ON public.scheduled_notifications TO service_role;

-- 7) chat-files bucket policies
DROP POLICY IF EXISTS "Anyone can view chat files" ON storage.objects;
DROP POLICY IF EXISTS "Public can view chat files" ON storage.objects;
DROP POLICY IF EXISTS "chat-files public read" ON storage.objects;
CREATE POLICY "chat-files: public read individual objects"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-files');

DROP POLICY IF EXISTS "Users can upload their own chat files" ON storage.objects;
CREATE POLICY "chat-files: users upload to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own chat files" ON storage.objects;
CREATE POLICY "chat-files: users update own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'chat-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own chat files" ON storage.objects;
CREATE POLICY "chat-files: users delete own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 8) SECURITY DEFINER execute lockdown
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid) TO service_role;
