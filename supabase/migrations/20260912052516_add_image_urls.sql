ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS hero_image_url text DEFAULT '';
ALTER TABLE public.project_parts ADD COLUMN IF NOT EXISTS image_url text DEFAULT '';
