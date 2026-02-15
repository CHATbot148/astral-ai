
-- Create generated_videos table for tracking video generations and gallery
CREATE TABLE public.generated_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  video_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.generated_videos ENABLE ROW LEVEL SECURITY;

-- Users can view their own videos
CREATE POLICY "Users can view their own videos"
ON public.generated_videos FOR SELECT
USING (auth.uid()::text = user_id::text);

-- Users can insert their own videos
CREATE POLICY "Users can insert their own videos"
ON public.generated_videos FOR INSERT
WITH CHECK (auth.uid()::text = user_id::text);

-- Users can delete their own videos
CREATE POLICY "Users can delete their own videos"
ON public.generated_videos FOR DELETE
USING (auth.uid()::text = user_id::text);
