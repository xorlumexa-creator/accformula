-- A job can defer a required test the backend cannot run yet (recorded, never silently dropped) and can carry the
-- quality-gate limit for critical rule violations. A part with deferred tests is never marked as passed.
alter table public.part_design_jobs
  add column if not exists max_critical_violations int not null default 0,
  add column if not exists deferred_tests jsonb not null default '[]'::jsonb,
  add column if not exists note text;

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
    || '&max_critical_violations=' || j.max_critical_violations::text
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
    'deferred_tests', j.deferred_tests,
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
    -- deferred tests mean the part is saved but NOT marked as passed
    update public.project_parts set cad_script = j.script, stl_base64 = r->>'generated_stl_base64',
      stl_quality_passed = (jsonb_array_length(j.deferred_tests) = 0), stl_iterations_used = j.iteration where id = j.part_id;
  end if;
  return jsonb_build_object('status', st, 'summary', sm);
end $$;

revoke all on all functions in schema lumexa_runner from public, anon, authenticated;
