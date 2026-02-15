
-- Create promo_codes table
CREATE TABLE public.promo_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'pro',
  duration_days INTEGER NOT NULL DEFAULT 30,
  max_uses INTEGER NOT NULL DEFAULT 1,
  current_uses INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- Anyone can read promo codes (to validate them)
CREATE POLICY "Anyone can read active promo codes"
ON public.promo_codes FOR SELECT
USING (true);

-- Only service role can modify (no user insert/update/delete)
CREATE POLICY "Deny user inserts"
ON public.promo_codes FOR INSERT
WITH CHECK (false);

CREATE POLICY "Deny user updates"
ON public.promo_codes FOR UPDATE
USING (false);

CREATE POLICY "Deny user deletes"
ON public.promo_codes FOR DELETE
USING (false);

-- Create promo_code_redemptions table
CREATE TABLE public.promo_code_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  promo_code_id UUID NOT NULL REFERENCES public.promo_codes(id),
  redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.promo_code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own redemptions"
ON public.promo_code_redemptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own redemptions"
ON public.promo_code_redemptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Insert 20 Pro promo codes
INSERT INTO public.promo_codes (code, tier, duration_days, max_uses) VALUES
('XPRO-FREE-A1B2C3', 'pro', 30, 1),
('XPRO-FREE-D4E5F6', 'pro', 30, 1),
('XPRO-FREE-G7H8I9', 'pro', 30, 1),
('XPRO-FREE-J0K1L2', 'pro', 30, 1),
('XPRO-FREE-M3N4O5', 'pro', 30, 1),
('XPRO-FREE-P6Q7R8', 'pro', 30, 1),
('XPRO-FREE-S9T0U1', 'pro', 30, 1),
('XPRO-FREE-V2W3X4', 'pro', 30, 1),
('XPRO-FREE-Y5Z6A7', 'pro', 30, 1),
('XPRO-FREE-B8C9D0', 'pro', 30, 1),
('XPRO-FREE-E1F2G3', 'pro', 30, 1),
('XPRO-FREE-H4I5J6', 'pro', 30, 1),
('XPRO-FREE-K7L8M9', 'pro', 30, 1),
('XPRO-FREE-N0O1P2', 'pro', 30, 1),
('XPRO-FREE-Q3R4S5', 'pro', 30, 1),
('XPRO-FREE-T6U7V8', 'pro', 30, 1),
('XPRO-FREE-W9X0Y1', 'pro', 30, 1),
('XPRO-FREE-Z2A3B4', 'pro', 30, 1),
('XPRO-FREE-C5D6E7', 'pro', 30, 1),
('XPRO-FREE-F8G9H0', 'pro', 30, 1);
