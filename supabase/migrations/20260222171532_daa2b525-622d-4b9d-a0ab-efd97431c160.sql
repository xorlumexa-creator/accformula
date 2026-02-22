
-- Chat sessions
CREATE TABLE public.chat_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat sessions" ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat sessions" ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chat sessions" ON public.chat_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat sessions" ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON public.chat_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Chat messages
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat messages" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat messages" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Telemetry sessions (stores any CSV data with dynamic columns)
CREATE TABLE public.telemetry_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telemetry_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own telemetry" ON public.telemetry_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own telemetry" ON public.telemetry_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own telemetry" ON public.telemetry_sessions FOR DELETE USING (auth.uid() = user_id);

-- Sensor configurations
CREATE TABLE public.sensor_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sensor_name TEXT NOT NULL DEFAULT '',
  sensor_type TEXT NOT NULL DEFAULT 'Custom',
  connection_type TEXT NOT NULL DEFAULT 'HTTP POST',
  device_address TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sensor_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sensors" ON public.sensor_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sensors" ON public.sensor_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sensors" ON public.sensor_configs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sensors" ON public.sensor_configs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_sensor_configs_updated_at BEFORE UPDATE ON public.sensor_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
