-- Saved assembly: the result of the last assembly build for one macro part (placements, mates, hardware, measured space,
-- fit checks) plus the vision check of it. The assembly page loads this instead of rebuilding, and rebuilds by itself when a
-- part's CAD script no longer matches `fingerprint`. Meshes are not stored here; they live in the part-stl-files bucket
-- under "{user_id}/asm-{macro_part_id}-{part_id}.stl" (first path segment = user id, so the bucket's policies apply).
CREATE TABLE IF NOT EXISTS public.project_assemblies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  macro_part_id uuid NOT NULL REFERENCES public.project_macro_parts(id) ON DELETE CASCADE,
  fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,   -- part id -> hash of the CAD script that was assembled
  housing_key text,                                  -- hash of which components each part must hold
  result jsonb NOT NULL,                             -- assembly result without meshes
  mesh_paths jsonb NOT NULL DEFAULT '{}'::jsonb,     -- part id -> storage path of its mesh
  vision jsonb,                                      -- {verdict, summary, issues[], model, checked_at}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (macro_part_id)
);

ALTER TABLE public.project_assemblies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assemblies" ON public.project_assemblies FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can insert own assemblies" ON public.project_assemblies FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users can update own assemblies" ON public.project_assemblies FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users can delete own assemblies" ON public.project_assemblies FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS project_assemblies_user_id_idx ON public.project_assemblies (user_id);
CREATE INDEX IF NOT EXISTS project_assemblies_project_id_idx ON public.project_assemblies (project_id);

CREATE TRIGGER update_project_assemblies_updated_at BEFORE UPDATE ON public.project_assemblies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
