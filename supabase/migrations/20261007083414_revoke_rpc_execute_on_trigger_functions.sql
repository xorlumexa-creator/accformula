-- Trigger-only SECURITY DEFINER functions must not be callable through /rest/v1/rpc.
-- Triggers keep firing: EXECUTE is only checked when a trigger is created, not when it fires.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- public.rls_auto_enable() is not created by any migration in this repo (it comes from Supabase's
-- "automatically enable RLS" project setting), so it can be missing on a project rebuilt from these
-- files. The live project has it, where this behaves exactly like the original plain REVOKE.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
