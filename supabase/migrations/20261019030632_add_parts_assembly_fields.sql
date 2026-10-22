alter table public.project_parts add column if not exists housed_components jsonb not null default '[]'::jsonb;
alter table public.project_parts add column if not exists mounting jsonb;
comment on column public.project_parts.housed_components is 'components this part holds, [{component, quantity}], named as in project_electronics; the cavity requirement is computed from their datasheet sizes';
comment on column public.project_parts.mounting is 'how this part attaches: {method, fastener, connects_to[]}';
