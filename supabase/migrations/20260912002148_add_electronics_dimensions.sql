-- Add physical package dimensions for electronics/ICs (e.g. "SOIC-8, 4.9x3.9x1.75mm")
ALTER TABLE public.project_electronics
  ADD COLUMN IF NOT EXISTS dimensions text DEFAULT '';
