create index if not exists idx_chat_messages_session_id on public.chat_messages (session_id);
create index if not exists idx_project_electronics_project_id on public.project_electronics (project_id);
create index if not exists idx_project_macro_parts_project_id on public.project_macro_parts (project_id);
create index if not exists idx_project_parts_macro_part_id on public.project_parts (macro_part_id);
create index if not exists idx_project_parts_project_id on public.project_parts (project_id);
create index if not exists idx_project_tasks_project_id on public.project_tasks (project_id);
create index if not exists idx_projects_user_id on public.projects (user_id);
