-- Image feature dropped — no hero image or part image generation is planned
ALTER TABLE public.projects DROP COLUMN IF EXISTS hero_image_url;
ALTER TABLE public.project_parts DROP COLUMN IF EXISTS image_url;
