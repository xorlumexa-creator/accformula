-- Opt-in flag: only rows marked auto_submit are ever started by the scheduler (drafts are never fired by accident).
alter table public.part_design_jobs add column if not exists auto_submit boolean not null default false;

create table if not exists lumexa_runner.tick_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  info jsonb not null
);

create or replace function lumexa_runner.tick() returns jsonb
language plpgsql
as $fn$
declare
  j record; jid uuid; probe jsonb; st int; r jsonb; health jsonb;
  sub jsonb := null; res jsonb;
  polled int := 0; waiting int := 0; settled jsonb := '[]'::jsonb;
begin
  -- one tick at a time (released automatically at the end of the transaction)
  if not pg_try_advisory_xact_lock(727001) then
    return jsonb_build_object('skipped', 'another tick is still running');
  end if;
  begin
    -- 1. settle running jobs, but ONLY on a real answer from the backend:
    --    200 = job known (running or finished), 404 = job lost in a backend restart.
    --    Anything else (no connection, 5xx, Cloudflare 52x/530) is a tunnel blip: leave the job running.
    for j in select id, backend_job_id from public.part_design_jobs
             where status = 'running' and backend_job_id is not null order by submitted_at nulls last loop
      probe := lumexa_runner.backend_call('GET', '/job/' || j.backend_job_id, null, null, 30);
      st := coalesce((probe->>'http_status')::int, 0);
      if st in (200, 404) then
        r := lumexa_runner.poll_job(j.id);
        polled := polled + 1;
        settled := settled || jsonb_build_array(jsonb_build_object('job', j.id, 'status', r->>'status'));
      else
        waiting := waiting + 1;
      end if;
    end loop;

    -- 2. nothing running: start the oldest queued job that opted in, after a health check
    if not exists (select 1 from public.part_design_jobs where status = 'running') then
      select id into jid from public.part_design_jobs where status = 'queued' and auto_submit order by created_at limit 1;
      if jid is not null then
        health := lumexa_runner.backend_call('GET', '/ccx-health', null, null, 20);
        if (health->>'http_status')::int = 200 then
          sub := jsonb_build_object('job', jid) || lumexa_runner.submit_job(jid);
        else
          sub := jsonb_build_object('job', jid, 'status', 'queued', 'note', 'backend unreachable, will retry');
        end if;
      end if;
    end if;

    res := jsonb_build_object('polled', polled, 'unreachable_kept_running', waiting, 'settled', settled, 'submitted', sub);
    if polled > 0 or waiting > 0 or sub is not null then
      insert into lumexa_runner.tick_log(info) values (res);
      delete from lumexa_runner.tick_log where id < (select max(id) - 500 from lumexa_runner.tick_log);
    end if;
    return res;
  exception when others then
    insert into lumexa_runner.tick_log(info) values (jsonb_build_object('error', sqlerrm));
    return jsonb_build_object('error', sqlerrm);
  end;
end $fn$;

create extension if not exists pg_cron;
select cron.schedule('lumexa-tick', '30 seconds', $cron$select lumexa_runner.tick()$cron$);
