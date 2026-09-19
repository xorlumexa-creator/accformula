ALTER TABLE public.project_parts
  ADD COLUMN IF NOT EXISTS purpose text DEFAULT '',
  ADD COLUMN IF NOT EXISTS subsystem text DEFAULT '';
