
-- Extend profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS country text DEFAULT '',
  ADD COLUMN IF NOT EXISTS occupation text DEFAULT '',
  ADD COLUMN IF NOT EXISTS experience_level text DEFAULT '',
  ADD COLUMN IF NOT EXISTS cad_software text DEFAULT '',
  ADD COLUMN IF NOT EXISTS primary_purpose text DEFAULT '';

-- Extend projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS environment text DEFAULT '',
  ADD COLUMN IF NOT EXISTS power_source text DEFAULT '',
  ADD COLUMN IF NOT EXISTS control_method text DEFAULT '',
  ADD COLUMN IF NOT EXISTS microcontroller text DEFAULT '',
  ADD COLUMN IF NOT EXISTS has_3d_printer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_weight text DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_size text DEFAULT '',
  ADD COLUMN IF NOT EXISTS budget_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS current_phase integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS progress_percent integer DEFAULT 0;

-- Project parts (body parts)
CREATE TABLE public.project_parts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  part_name text NOT NULL DEFAULT '',
  material text DEFAULT '',
  manufacturing_method text DEFAULT '',
  estimated_cost numeric DEFAULT 0,
  complexity text DEFAULT 'Beginner',
  status text DEFAULT 'Not Started',
  design_guide text DEFAULT '',
  fix_guide text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own parts" ON public.project_parts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own parts" ON public.project_parts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own parts" ON public.project_parts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own parts" ON public.project_parts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_parts_updated_at BEFORE UPDATE ON public.project_parts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Project electronics
CREATE TABLE public.project_electronics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  component_name text NOT NULL DEFAULT '',
  model_recommendation text DEFAULT '',
  where_to_buy text DEFAULT '',
  price numeric DEFAULT 0,
  quantity integer DEFAULT 1,
  purpose text DEFAULT '',
  status text DEFAULT 'Not Purchased',
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_electronics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own electronics" ON public.project_electronics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own electronics" ON public.project_electronics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own electronics" ON public.project_electronics FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own electronics" ON public.project_electronics FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_electronics_updated_at BEFORE UPDATE ON public.project_electronics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Project tasks
CREATE TABLE public.project_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  task_number integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  estimated_hours numeric DEFAULT 2,
  status text DEFAULT 'Not Started',
  phase integer DEFAULT 1,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks" ON public.project_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own tasks" ON public.project_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tasks" ON public.project_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tasks" ON public.project_tasks FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_tasks_updated_at BEFORE UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User streaks
CREATE TABLE public.user_streaks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  current_streak integer DEFAULT 0,
  longest_streak integer DEFAULT 0,
  last_active_date date,
  streak_freeze_available boolean DEFAULT true,
  streak_freeze_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own streak" ON public.user_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own streak" ON public.user_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own streak" ON public.user_streaks FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_streaks_updated_at BEFORE UPDATE ON public.user_streaks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
