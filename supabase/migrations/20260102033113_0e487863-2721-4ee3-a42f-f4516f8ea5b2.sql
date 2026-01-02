-- Add user_memory table for storing user preferences across chats
CREATE TABLE public.user_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable RLS
ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own memory" 
ON public.user_memory 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory" 
ON public.user_memory 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memory" 
ON public.user_memory 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own memory" 
ON public.user_memory 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_user_memory_updated_at
BEFORE UPDATE ON public.user_memory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();