-- Plan 11 Task 6: wire ban inserts/updates to void-propagation helpers.
--
-- INSERT:    sanction_type='ban' + not revoked + not deleted  → propagate
-- REVOKE:    revoked_at NULL → NOT NULL (ban)                  → unpropagate
-- SOFT-DEL:  deleted_at NULL → NOT NULL (ban)                  → unpropagate
-- DATE EDIT: effective_from/until changed (still ban)          → un-then-re-propagate

create or replace function public.on_ban_action_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.sanction_type = 'ban'
       and new.deleted_at is null and new.revoked_at is null then
    perform public.propagate_suspension_voids(new.id);
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif old.deleted_at is null and new.deleted_at is not null and new.sanction_type = 'ban' then
      perform public.unpropagate_suspension_voids(new.id);
    elsif new.sanction_type = 'ban'
       and new.deleted_at is null
       and new.revoked_at is null
       and (
         coalesce(new.effective_from, '0001-01-01'::date) <> coalesce(old.effective_from, '0001-01-01'::date)
         or coalesce(new.effective_until, '0001-01-01'::date) <> coalesce(old.effective_until, '0001-01-01'::date)
       ) then
      perform public.unpropagate_suspension_voids(new.id);
      perform public.propagate_suspension_voids(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists disciplinary_actions_ban_propagation on public.disciplinary_actions;
create trigger disciplinary_actions_ban_propagation
  after insert or update on public.disciplinary_actions
  for each row execute function public.on_ban_action_change();
