
DROP FUNCTION IF EXISTS public.redeem_promo_code(text, uuid);

CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text, p_user_id uuid)
RETURNS TABLE(success boolean, error_message text, tier text, duration_days integer, code_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_id uuid;
  v_tier text;
  v_duration_days integer;
  v_current_uses integer;
  v_max_uses integer;
  v_is_active boolean;
  v_expires_at timestamptz;
  v_existing_redemption uuid;
BEGIN
  SELECT pc.id, pc.tier, pc.duration_days, pc.current_uses, pc.max_uses, pc.is_active, pc.expires_at
  INTO v_code_id, v_tier, v_duration_days, v_current_uses, v_max_uses, v_is_active, v_expires_at
  FROM promo_codes pc
  WHERE pc.code = p_code
  FOR UPDATE;

  IF v_code_id IS NULL THEN
    RETURN QUERY SELECT false, 'Invalid promo code'::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF NOT v_is_active THEN
    RETURN QUERY SELECT false, 'This code is no longer active'::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_current_uses >= v_max_uses THEN
    RETURN QUERY SELECT false, 'This code has already been used'::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN QUERY SELECT false, 'This code has expired'::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  SELECT pcr.id INTO v_existing_redemption
  FROM promo_code_redemptions pcr
  WHERE pcr.user_id = p_user_id AND pcr.promo_code_id = v_code_id;

  IF v_existing_redemption IS NOT NULL THEN
    RETURN QUERY SELECT false, 'You have already used this code'::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = v_code_id;
  INSERT INTO promo_code_redemptions (user_id, promo_code_id) VALUES (p_user_id, v_code_id);

  RETURN QUERY SELECT true, NULL::text, v_tier, v_duration_days, v_code_id;
END;
$$;
