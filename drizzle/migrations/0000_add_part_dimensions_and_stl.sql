ALTER TABLE public.project_parts
  ADD COLUMN IF NOT EXISTS dimensions text,
  ADD COLUMN IF NOT EXISTS stl_base64 text,
  ADD COLUMN IF NOT EXISTS stl_quality_passed boolean,
  ADD COLUMN IF NOT EXISTS stl_iterations_used integer;

ALTER TABLE public.project_electronics
  ADD COLUMN IF NOT EXISTS dimensions text;