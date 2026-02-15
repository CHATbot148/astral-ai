
-- Fix promo_codes: drop the restrictive SELECT policy and create a permissive one
DROP POLICY IF EXISTS "Anyone can read active promo codes" ON public.promo_codes;
CREATE POLICY "Anyone can read active promo codes"
  ON public.promo_codes
  FOR SELECT
  USING (is_active = true);

-- Fix promo_code_redemptions: drop restrictive policies and create permissive ones
DROP POLICY IF EXISTS "Users can insert own redemptions" ON public.promo_code_redemptions;
DROP POLICY IF EXISTS "Users can view own redemptions" ON public.promo_code_redemptions;

CREATE POLICY "Users can insert own redemptions"
  ON public.promo_code_redemptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own redemptions"
  ON public.promo_code_redemptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Deactivate all old pro codes
UPDATE public.promo_codes SET is_active = false WHERE tier = 'pro';

-- Insert 10 new basic plan codes
INSERT INTO public.promo_codes (code, tier, duration_days, max_uses, current_uses, is_active) VALUES
  ('XBASIC-FREE-R1S2T3', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-U4V5W6', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-X7Y8Z9', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-A2B3C4', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-D5E6F7', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-G8H9I0', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-J1K2L3', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-M4N5O6', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-P7Q8R9', 'basic', 30, 1, 0, true),
  ('XBASIC-FREE-S0T1U2', 'basic', 30, 1, 0, true);
