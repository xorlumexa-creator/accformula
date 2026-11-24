-- The backend address now lives in a one-row config table, so changing a tunnel address is an UPDATE, not a migration.
create table if not exists lumexa_runner.config (key text primary key, value text not null);
insert into lumexa_runner.config (key, value) values ('backend_url', 'https://v8-wa56.onrender.com') on conflict (key) do nothing;
create or replace function lumexa_runner.backend_url() returns text language sql stable as
$$ select rtrim(value, '/') from lumexa_runner.config where key = 'backend_url' $$;
revoke all on lumexa_runner.config from public, anon, authenticated;
revoke all on all functions in schema lumexa_runner from public, anon, authenticated;
