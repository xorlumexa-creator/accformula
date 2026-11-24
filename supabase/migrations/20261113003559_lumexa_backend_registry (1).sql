-- Backend address for the app.
--
-- The tablet scripts (start_all.sh / tunnel.sh) register the Cloudflare tunnel address with
-- public.lumexa_register_backend(p_url, p_secret). The address is stored in lumexa_runner.config under key 'backend_url'
-- (the server-side job runner reads the same value). The live project already has both.
--
-- This migration
--   1. adds public.lumexa_get_backend(), so the signed-in app can read that address (see src/lib/backendUrl.ts), and
--   2. on a project that has no registry yet (a rebuild from these files), creates the same store and register function.
-- Objects that already exist are never replaced, so it is safe on the live project.
--
-- Fresh project only - set the registration secret once in the SQL editor and use the same value as REG in ~/.lumexa.env:
--   insert into lumexa_runner.config (key, value) values ('register_secret', '<random string, 24+ characters>')
--   on conflict (key) do update set value = excluded.value;
--
-- lumexa_register_backend is callable by anon on purpose (the tablet has no user session). It is gated by the secret and
-- only accepts https://<name>.trycloudflare.com. Supabase's linter lists it as an anon-executable SECURITY DEFINER function.

DO $boot$
BEGIN
  IF to_regclass('lumexa_runner.config') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS lumexa_runner;
    CREATE TABLE lumexa_runner.config (key text PRIMARY KEY, value text);
    ALTER TABLE lumexa_runner.config ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON SCHEMA lumexa_runner FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON lumexa_runner.config FROM PUBLIC, anon, authenticated;
    INSERT INTO lumexa_runner.config (key, value) VALUES ('backend_url', '') ON CONFLICT (key) DO NOTHING;
  END IF;

  IF to_regprocedure('public.lumexa_register_backend(text,text)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.lumexa_register_backend(p_url text, p_secret text)
      RETURNS text
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $fn$
      DECLARE
        v_secret text;
      BEGIN
        SELECT value INTO v_secret FROM lumexa_runner.config WHERE key = 'register_secret';
        IF v_secret IS NULL OR v_secret = '' OR p_secret IS DISTINCT FROM v_secret THEN
          PERFORM pg_sleep(1);                                   -- slows down guessing
          RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
        END IF;
        IF p_url !~ '^https://[a-z0-9-]+\.trycloudflare\.com$' THEN
          RAISE EXCEPTION 'url must look like https://something.trycloudflare.com';
        END IF;
        UPDATE lumexa_runner.config SET value = p_url WHERE key = 'backend_url';
        RETURN 'ok: ' || p_url;
      END $fn$
    $f$;
    REVOKE EXECUTE ON FUNCTION public.lumexa_register_backend(text, text) FROM PUBLIC;
    GRANT  EXECUTE ON FUNCTION public.lumexa_register_backend(text, text) TO anon, authenticated;
  END IF;
END $boot$;

-- Read side for the app (signed-in users only). Returns NULL when no address has been registered yet.
CREATE OR REPLACE FUNCTION public.lumexa_get_backend()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF to_regclass('lumexa_runner.config') IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT nullif(value, '') FROM lumexa_runner.config WHERE key = 'backend_url');
END $$;

REVOKE EXECUTE ON FUNCTION public.lumexa_get_backend() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lumexa_get_backend() TO authenticated;
