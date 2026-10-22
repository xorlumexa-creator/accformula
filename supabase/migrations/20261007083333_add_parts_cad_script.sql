alter table public.project_parts add column if not exists cad_script text;
comment on column public.project_parts.cad_script is 'build123d script of the last generated design; lets the backend rebuild STEP/GLB/OBJ/BREP on demand';
