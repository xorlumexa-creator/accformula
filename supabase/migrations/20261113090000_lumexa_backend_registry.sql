-- Where the CAD / FEA backend lives right now.
--
-- The backend runs on a tablet behind a Cloudflare quick tunnel, so its address changes whenever the tunnel restarts.
-- start_all.sh / tunnel.sh call lumexa_register_backend(p_url, p_secret) with the new address (they authenticate with the
-- project's anon key plus a registration secret). The app calls lumexa_get_backend() to find it (see src/lib/backendUrl.ts).
--
-- ONE-TIME SETUP after this migration is applied (SQL editor, runs as postgres):
--   select public.lumexa_set_backend_secret('<a random string of at least 24 characters>');
-- and put the same string in ~/.lumexa.env on the tablet as REG=...   (openssl rand -hex 32 makes a good one)
--
-- Security notes
--  * The table has RLS on, no policies and no grants for anon/authenticated: nobody reads or writes it directly.
--  * lumexa_register_backend is callable by anon ON PURPOSE (the tablet scripts have no user session). It is gated by the
--    secret, accepts only https addresses whose host ends with one of allowed_suffixes, and sleeps on a wrong secret.
--    Supabase's linter will list it as an anon-executable SECURITY DEFINER function; that is expected here.
--  * Only the SHA-256 of the secret is stored.

CREATE TABLE IF NOT EXISTS public.backend_registry (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),               -- exactly one row
  url text,
  secret_hash text,
  allowed_suffixes text[] NOT NULL DEFAULT ARRAY['trycloudflare.com', 'onrender.com'],
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backend_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backend_registry FROM PUBLIC, anon, authenticated;

INSERT INTO public.backend_registry (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Called by the tablet scripts. Returns {"ok":true,"url":...}; raises on a bad secret or an address that is not allowed.
CREATE OR REPLACE FUNCTION public.lumexa_register_backend(p_url text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row  public.backend_registry%ROWTYPE;
  v_url  text := rtrim(btrim(coalesce(p_url, '')), '/');
  v_host text;
BEGIN
  SELECT * INTO v_row FROM public.backend_registry WHERE id = 1;

  IF v_row.secret_hash IS NULL THEN
    RAISE EXCEPTION 'backend registration is not set up: run select public.lumexa_set_backend_secret(...) first' USING ERRCODE = '28000';
  END IF;

  IF encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex') <> v_row.secret_hash THEN
    PERFORM pg_sleep(1);                                            -- slows down guessing
    RAISE EXCEPTION 'invalid registration secret' USING ERRCODE = '28000';
  END IF;

  IF v_url !~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'backend address must be https://host[:port] with no path' USING ERRCODE = '22023';
  END IF;

  v_host := lower(substring(v_url FROM '^https://([^:/]+)'));
  IF NOT EXISTS (
    SELECT 1 FROM unnest(v_row.allowed_suffixes) AS t(suffix)
    WHERE v_host = t.suffix OR right(v_host, length(t.suffix) + 1) = '.' || t.suffix
  ) THEN
    RAISE EXCEPTION 'backend host % is not in allowed_suffixes', v_host USING ERRCODE = '22023';
  END IF;

  UPDATE public.backend_registry SET url = v_url, updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('ok', true, 'url', v_url, 'updated_at', now());
END;
$$;

-- Called by the app (signed-in users only).
CREATE OR REPLACE FUNCTION public.lumexa_get_backend()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT url FROM public.backend_registry WHERE id = 1;
$$;

-- Admin helper: sets / rotates the registration secret. Not callable from the API.
CREATE OR REPLACE FUNCTION public.lumexa_set_backend_secret(p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF length(coalesce(p_secret, '')) < 24 THEN
    RAISE EXCEPTION 'use a secret of at least 24 characters';
  END IF;
  UPDATE public.backend_registry
     SET secret_hash = encode(sha256(convert_to(p_secret, 'utf8')), 'hex'), updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lumexa_register_backend(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lumexa_register_backend(text, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.lumexa_get_backend() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lumexa_get_backend() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.lumexa_set_backend_secret(text) FROM PUBLIC, anon, authenticated;
