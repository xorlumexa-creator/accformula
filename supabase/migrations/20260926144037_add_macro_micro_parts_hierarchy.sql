-- Recovered from the live project's recorded migration history (version 20260926144037).
-- Parts are now generated in two stages: a small "macro parts" list (assemblies, e.g. "Arms",
-- "Frame") is generated with the project plan, and each macro part's individual "micro parts"
-- (the actual manufacturable pieces) are generated on demand, only once the user opens that
-- assembly on the Parts page — this is what keeps each LLM call small instead of asking for a
-- whole 25-40 part project in one shot.

-- Full original brief (all interview answers, including fields not mirrored into dedicated
-- projects columns, e.g. connectivity/specialRequirements/assumptions) so a micro-parts
-- generation call — which can happen much later, in a different browser session — has the
-- complete original context to reason with, not just the subset already stored on the row.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS brief_json jsonb;

CREATE TABLE public.project_macro_parts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  purpose text DEFAULT '',
  subsystem text DEFAULT '',
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'generating' | 'generated' | 'error'
  micro_parts_error text,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_macro_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own macro parts" ON public.project_macro_parts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own macro parts" ON public.project_macro_parts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own macro parts" ON public.project_macro_parts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own macro parts" ON public.project_macro_parts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_macro_parts_updated_at BEFORE UPDATE ON public.project_macro_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nullable: existing project_parts rows created before this migration have no macro grouping
-- and simply render ungrouped; every row created going forward will always set this.
ALTER TABLE public.project_parts ADD COLUMN IF NOT EXISTS macro_part_id uuid REFERENCES public.project_macro_parts(id) ON DELETE CASCADE;
