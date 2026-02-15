
-- Add unique constraint on promo_code_redemptions to prevent duplicate redemptions
ALTER TABLE promo_code_redemptions 
ADD CONSTRAINT unique_user_promo UNIQUE (user_id, promo_code_id);

-- Create atomic promo code redemption function
CREATE OR REPLACE FUNCTION public.redeem_promo_code(
  p_code TEXT,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  tier TEXT,
  duration_days INTEGER,
  error_message TEXT,
  code_id UUID
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_id UUID;
  v_tier TEXT;
  v_duration INTEGER;
BEGIN
  -- Atomic increment with row lock
  UPDATE promo_codes 
  SET current_uses = current_uses + 1
  WHERE code = p_code 
    AND is_active = true
    AND current_uses < max_uses
    AND (expires_at IS NULL OR expires_at > NOW())
  RETURNING id, tier, duration_days 
  INTO v_code_id, v_tier, v_duration;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::INTEGER, 
      'Code invalid, expired, or max uses reached'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Prevent duplicate redemptions
  INSERT INTO promo_code_redemptions (user_id, promo_code_id)
  VALUES (p_user_id, v_code_id)
  ON CONFLICT (user_id, promo_code_id) DO NOTHING;
  
  IF NOT FOUND THEN
    -- Already redeemed, rollback increment
    UPDATE promo_codes SET current_uses = current_uses - 1 
    WHERE id = v_code_id;
    RETURN QUERY SELECT false, NULL::TEXT, NULL::INTEGER, 
      'You already redeemed this code'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT true, v_tier, v_duration, NULL::TEXT, v_code_id;
END;
$$;
