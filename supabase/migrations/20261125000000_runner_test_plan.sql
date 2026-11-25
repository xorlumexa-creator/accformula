-- Lets a design job carry a test plan, so the backend runs real CalculiX FEM instead of the generic load case.
--
-- Found while testing the backend end to end: lumexa_runner.submit_job never sent `test_plan_json` to
-- /generate-from-script-async. With only `required_tests`, the backend reports each test as GENERIC
-- ("no test plan, so only the single generic load case ran") and CalculiX is never used. With a plan, the same job
-- runs the solver and reports per-test von Mises stress, safety factor and deflection.
--
--  * part_design_jobs.test_plan : optional jsonb in the backend's test-plan format (GET /test-plan-schema -> example_plan)
--  * submit_job                 : sends it as test_plan_json when present
--  * poll_job                   : keeps test_plan_results and fea_method in `summary`, so the agent can read the numbers
--                                 and refine the script
alter table public.part_design_jobs add column if not exists test_plan jsonb;

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
    || '&required_tests=' || lumexa_runner.urlencode(j.required_tests::text)
    || case when j.test_plan is not null then '&test_plan_json=' || lumexa_runner.urlencode(j.test_plan::text) else '' end;
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
    'test_plan_results', r->'test_plan_results',
    'fea_method', r->'fea_method',
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
