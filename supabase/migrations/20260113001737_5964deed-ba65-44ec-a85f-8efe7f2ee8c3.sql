-- Create email_otps table for OTP verification
CREATE TABLE public.email_otps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX idx_email_otps_email ON public.email_otps(email);
CREATE INDEX idx_email_otps_expires_at ON public.email_otps(expires_at);

-- Enable RLS
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (no public access)
-- No policies needed as edge functions use service role key