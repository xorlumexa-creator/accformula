alter table public.project_parts add column if not exists required_tests jsonb not null default '[]'::jsonb;

alter table public.project_parts add constraint project_parts_required_tests_valid
  check (jsonb_typeof(required_tests) = 'array' and required_tests <@ '["static_stress","buckling","thermal_stress"]'::jsonb);

comment on column public.project_parts.required_tests is 'analyses this part must pass, named as in test_plan.py: static_stress, buckling, thermal_stress. An empty array means not specified (Lumexa decides).';
