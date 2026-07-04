REVOKE EXECUTE ON FUNCTION public.expire_due_subscriptions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_due_subscriptions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_due_subscriptions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_subscriptions() TO service_role;