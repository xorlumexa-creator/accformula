-- Recovered from the live project's recorded migration history (version 20260925104256).
-- Move generated STL files out of the project_parts text column (stl_base64) and into
-- Supabase Storage. Postgres text columns are a poor fit for binary payloads (they don't
-- compress or stream well, and bloat the free-tier 500MB database quota fast); Storage is
-- built for this and is billed/limited separately. stl_base64 is left in place, unused by
-- new writes, purely so any already-saved STL keeps working without a data migration.
ALTER TABLE public.project_parts
  ADD COLUMN IF NOT EXISTS stl_storage_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('part-stl-files', 'part-stl-files', false, 26214400) -- 25 MB/part
ON CONFLICT (id) DO NOTHING;

-- Object path convention: "{user_id}/{part_id}.stl" — storage.foldername(name)[1] is the
-- first path segment, so this mirrors the same "auth.uid() = owner" pattern the other
-- tables already use, scoped by path instead of a user_id column (storage.objects has no
-- such column of its own to filter on).
CREATE POLICY "Users can read own part STL files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'part-stl-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can upload own part STL files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'part-stl-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own part STL files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'part-stl-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own part STL files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'part-stl-files' AND (storage.foldername(name))[1] = auth.uid()::text);
