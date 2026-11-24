-- Design-loop runner: lets the Lumexa agent submit a build123d script to the backend, poll the result and
-- keep every iteration, all from SQL. The HTTP client lives in a private schema that API roles cannot use.
create schema if not exists lumexa_runner;
revoke all on schema lumexa_runner from public, anon, authenticated;
create extension if not exists http with schema lumexa_runner;

create table public.part_design_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  part_id uuid not null references public.project_parts(id) on delete cascade,
  user_id uuid not null,
  iteration int not null default 1,
  script text not null,
  prompt text,
  material text,
  force_n numeric not null default 120,
  force_dir text not null default 'z',
  required_tests jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','passed','failed','error')),
  backend_job_id text,
  summary jsonb,
  report_md text,
  stl_base64 text,
  error text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index idx_part_design_jobs_part on public.part_design_jobs (part_id, iteration);
alter table public.part_design_jobs enable row level security;
create policy "Users can view own design jobs" on public.part_design_jobs for select using (auth.uid() = user_id);
create trigger update_part_design_jobs_updated_at before update on public.part_design_jobs
  for each row execute function public.update_updated_at_column();

create or replace function lumexa_runner.backend_url() returns text language sql immutable as
$$ select 'https://v8-wa56.onrender.com'::text $$;

-- same mapping the Parts page uses: free-text material -> key of the backend's MATERIALS table
create or replace function lumexa_runner.material_key(p_raw text) returns text language sql immutable as
$$ select case
  when lower(coalesce(p_raw,'')) like '%inconel%' then 'inconel_718'
  when lower(coalesce(p_raw,'')) like '%titanium%' or lower(coalesce(p_raw,'')) like '%ti-6al%' then 'titanium_6al4v'
  when lower(coalesce(p_raw,'')) like '%stainless%' or lower(coalesce(p_raw,'')) like '%316%' then 'stainless_316l'
  when lower(coalesce(p_raw,'')) like '%steel%' or lower(coalesce(p_raw,'')) like '%4340%' then 'steel_4340'
  when lower(coalesce(p_raw,'')) like '%magnesium%' then 'magnesium_az31'
  when lower(coalesce(p_raw,'')) like '%carbon%' then 'carbon_fiber_ud'
  when lower(coalesce(p_raw,'')) like '%alsi10mg%' then 'alsi10mg_slm'
  when lower(coalesce(p_raw,'')) like '%7075%' then 'aluminum_7075'
  when lower(coalesce(p_raw,'')) like '%petg%' then 'petg_plastic'
  when lower(coalesce(p_raw,'')) ~ '\ypla\y' then 'pla_plastic'
  when lower(coalesce(p_raw,'')) like '%abs%' or lower(coalesce(p_raw,'')) like '%plastic%' or lower(coalesce(p_raw,'')) like '%nylon%' or lower(coalesce(p_raw,'')) like '%polymer%' then 'petg_plastic'
  else 'aluminum_6061' end $$;

create or replace function lumexa_runner.backend_call(p_method text, p_path text, p_body text default null,
  p_content_type text default null, p_timeout int default 100) returns jsonb language plpgsql as $$
declare r lumexa_runner.http_response;
begin
  perform lumexa_runner.http_set_curlopt('CURLOPT_TIMEOUT', p_timeout::text);
  perform lumexa_runner.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '40');
  if upper(p_method) = 'GET' then
    r := lumexa_runner.http_get(lumexa_runner.backend_url() || p_path);
  else
    r := lumexa_runner.http_post(lumexa_runner.backend_url() || p_path, p_body, p_content_type);
  end if;
  return jsonb_build_object('http_status', r.status, 'content_type', r.content_type, 'body', r.content);
exception when others then
  return jsonb_build_object('http_status', 0, 'error', sqlerrm);
end $$;

-- Submit one queued job to POST /generate-from-script-async (no LLM involved on the backend).
create or replace function lumexa_runner.submit_job(p_job uuid) returns jsonb language plpgsql as $$
declare j public.part_design_jobs; pt public.project_parts; body text; resp jsonb; b jsonb;
begin
  select * into j from public.part_design_jobs where id = p_job;
  if not found then raise exception 'job % not found', p_job; end if;
  select * into pt from public.project_parts where id = j.part_id;
  body := 'script=' || lumexa_runner.urlencode(j.script)
    || '&prompt=' || lumexa_runner.urlencode(coalesce(j.prompt, pt.part_name || '. ' || coalesce(pt.purpose, '')))
    || '&part_name=' || lumexa_runner.urlencode(pt.part_name)
    || '&material=' || lumexa_runner.urlencode(lumexa_runner.material_key(coalesce(j.material, pt.material)))
    || '&force_n=' || j.force_n::text
    || '&force_dir=' || lumexa_runner.urlencode(j.force_dir)
    || '&required_tests=' || lumexa_runner.urlencode(j.required_tests::text);
  resp := lumexa_runner.backend_call('POST', '/generate-from-script-async', body, 'application/x-www-form-urlencoded', 110);
  if (resp->>'http_status')::int = 200 then
    b := (resp->>'body')::jsonb;
    update public.part_design_jobs set status = 'running', backend_job_id = b->>'job_id', submitted_at = now(), error = null where id = p_job;
    return jsonb_build_object('status', 'running', 'backend_job_id', b->>'job_id');
  elsif (resp->>'http_status')::int = 409 then
    update public.part_design_jobs set status = 'queued', error = 'backend busy: ' || left(resp->>'body', 300) where id = p_job;
    return jsonb_build_object('status', 'queued', 'note', 'backend busy', 'detail', left(resp->>'body', 300));
  else
    update public.part_design_jobs set status = 'error', error = 'submit failed: ' || coalesce(resp->>'error', 'HTTP ' || (resp->>'http_status') || ' ' || left(resp->>'body', 400)) where id = p_job;
    return jsonb_build_object('status', 'error', 'detail', resp - 'body', 'body', left(resp->>'body', 400));
  end if;
end $$;

-- Poll the backend job; when it is complete, keep a compact summary, the report and the STL on the job row.
-- If the part passed every required test the script and STL are also written onto the part itself.
create or replace function lumexa_runner.poll_job(p_job uuid) returns jsonb language plpgsql as $$
declare j public.part_design_jobs; resp jsonb; r jsonb; passed boolean; st text; sm jsonb;
begin
  select * into j from public.part_design_jobs where id = p_job;
  if not found then raise exception 'job % not found', p_job; end if;
  if j.status in ('passed','failed','error') then return jsonb_build_object('status', j.status, 'note', 'already finished'); end if;
  if j.backend_job_id is null then return jsonb_build_object('status', j.status, 'note', 'not submitted yet'); end if;
  resp := lumexa_runner.backend_call('GET', '/job/' || j.backend_job_id, null, null, 100);
  if (resp->>'http_status')::int = 0 then
    return jsonb_build_object('status', 'running', 'note', 'poll failed, try again', 'detail', resp->>'error');
  end if;
  if (resp->>'http_status')::int <> 200 then
    update public.part_design_jobs set status = 'error', finished_at = now(),
      error = 'backend job ' || j.backend_job_id || ' -> HTTP ' || (resp->>'http_status') || ' ' || left(resp->>'body', 600) where id = p_job;
    return jsonb_build_object('status', 'error', 'http', resp->>'http_status', 'body', left(resp->>'body', 600));
  end if;
  begin r := (resp->>'body')::jsonb; exception when others then
    return jsonb_build_object('status', 'running', 'note', 'unreadable response', 'body', left(resp->>'body', 200)); end;
  if r->>'status' = 'running' then
    update public.part_design_jobs set updated_at = now() where id = p_job;
    return jsonb_build_object('status', 'running', 'backend', r);
  end if;
  passed := coalesce((r #>> '{refinement,passed_quality_gate}')::boolean, false);
  sm := jsonb_build_object(
    'passed', passed,
    'reasons', coalesce(r #> '{refinement,final_reasons}', '[]'::jsonb),
    'required_tests_status', r->'required_tests_status',
    'execution_error', r->'execution_error',
    'analysis_error', r->'analysis_error',
    'lint_issues', r->'lint_issues',
    'test_plan_diag', r->'test_plan_diag',
    'solver', r #>> '{analytical_fea,method}',
    'safety_factor', r #> '{analytical_fea,safety_factor}',
    'von_mises_mpa', r #> '{analytical_fea,stress,von_mises_mpa}',
    'deflection_mm', r #> '{analytical_fea,deflection_mm}');
  st := case when passed then 'passed' else 'failed' end;
  update public.part_design_jobs set status = st, finished_at = now(), summary = sm,
    report_md = r->>'analysis_report_md', stl_base64 = r->>'generated_stl_base64' where id = p_job;
  if passed and r->>'generated_stl_base64' is not null then
    update public.project_parts set cad_script = j.script, stl_base64 = r->>'generated_stl_base64',
      stl_quality_passed = true, stl_iterations_used = j.iteration where id = j.part_id;
  end if;
  return jsonb_build_object('status', st, 'summary', sm);
end $$;

-- Save the best attempt onto the part even when it did not pass (the app then shows it flagged, like its own loop does).
create or replace function lumexa_runner.finalize_job(p_job uuid) returns jsonb language plpgsql as $$
declare j public.part_design_jobs;
begin
  select * into j from public.part_design_jobs where id = p_job;
  if not found or j.stl_base64 is null then raise exception 'job % has no STL to save', p_job; end if;
  update public.project_parts set cad_script = j.script, stl_base64 = j.stl_base64,
    stl_quality_passed = (j.status = 'passed'), stl_iterations_used = j.iteration where id = j.part_id;
  return jsonb_build_object('saved', true, 'passed', j.status = 'passed');
end $$;

revoke all on all functions in schema lumexa_runner from public, anon, authenticated;
