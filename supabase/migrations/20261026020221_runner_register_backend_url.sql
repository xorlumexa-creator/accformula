-- The tablet registers its own tunnel address after every start (one curl), so nobody has to paste it.
-- Only a trycloudflare.com address is accepted, and only with the shared secret.
insert into lumexa_runner.config (key, value) values ('register_secret', replace(gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;

create or replace function public.lumexa_register_backend(p_url text, p_secret text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from (select value from lumexa_runner.config where key = 'register_secret') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_url !~ '^https://[a-z0-9-]+\.trycloudflare\.com$' then
    raise exception 'url must look like https://something.trycloudflare.com';
  end if;
  update lumexa_runner.config set value = p_url where key = 'backend_url';
  return 'ok: ' || p_url;
end $$;
revoke all on function public.lumexa_register_backend(text, text) from public;
grant execute on function public.lumexa_register_backend(text, text) to anon, authenticated;
