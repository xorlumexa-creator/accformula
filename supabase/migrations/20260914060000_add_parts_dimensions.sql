ALTER TABLE public.project_parts
  ADD COLUMN IF NOT EXISTS dimensions text DEFAULT '';
