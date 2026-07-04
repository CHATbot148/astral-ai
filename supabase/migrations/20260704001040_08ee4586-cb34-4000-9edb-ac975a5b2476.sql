CREATE OR REPLACE FUNCTION public.expire_due_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.subscriptions
  SET
    status = 'expired',
    tier = 'free',
    auto_renew = false,
    cancelled_at = COALESCE(access_until, expires_at, now()),
    access_until = COALESCE(access_until, expires_at, now()),
    updated_at = now()
  WHERE status = 'active'
    AND tier <> 'free'
    AND COALESCE(access_until, expires_at) IS NOT NULL
    AND COALESCE(access_until, expires_at) <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_due_subscriptions() TO service_role;

SELECT public.expire_due_subscriptions();