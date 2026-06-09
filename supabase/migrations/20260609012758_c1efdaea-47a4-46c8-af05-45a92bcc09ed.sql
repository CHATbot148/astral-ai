
ALTER TABLE public.user_memory
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'fact',
  ADD COLUMN IF NOT EXISTS importance smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS user_memory_user_category_idx
  ON public.user_memory (user_id, category);

CREATE INDEX IF NOT EXISTS user_memory_recall_idx
  ON public.user_memory (user_id, importance DESC, last_used_at DESC);
