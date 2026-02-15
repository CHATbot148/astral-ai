
-- Reactivate old pro codes and set them as active pro codes
UPDATE public.promo_codes SET is_active = true, current_uses = 0 WHERE code IN (
  'XPRO-FREE-A1B2C3','XPRO-FREE-D4E5F6','XPRO-FREE-G7H8I9','XPRO-FREE-J0K1L2','XPRO-FREE-M3N4O5',
  'XPRO-FREE-P6Q7R8','XPRO-FREE-S9T0U1','XPRO-FREE-V2W3X4','XPRO-FREE-Y5Z6A7','XPRO-FREE-B8C9D0'
);

-- Insert 10 Ultimate plan codes with unique names
INSERT INTO public.promo_codes (code, tier, duration_days, max_uses, current_uses, is_active) VALUES
  ('XULTIMATE-FREE-Q1R2S3', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-T4U5V6', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-W7X8Y9', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-Z0A1B2', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-C3D4E5', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-F6G7H8', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-I9J0K1', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-L2M3N4', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-O5P6Q7', 'ultimate', 30, 1, 0, true),
  ('XULTIMATE-FREE-R8S9T0', 'ultimate', 30, 1, 0, true);
