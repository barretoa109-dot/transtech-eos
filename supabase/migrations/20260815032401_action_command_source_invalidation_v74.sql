-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

drop trigger if exists eos_action_commands_invalidate_master_context
  on public.eos_action_commands;
drop trigger if exists eos_action_commands_invalidate_master_context_terminal
  on public.eos_action_commands;
drop trigger if exists eos_action_commands_invalidate_master_context_delete
  on public.eos_action_commands;

create trigger eos_action_commands_invalidate_master_context_terminal
after update of estado on public.eos_action_commands
for each row
when (
  old.estado is distinct from new.estado
  and new.estado in ('completada', 'error', 'no_disponible', 'cancelada')
)
execute function public.eos_invalidate_master_context();

create trigger eos_action_commands_invalidate_master_context_delete
after delete on public.eos_action_commands
for each row
execute function public.eos_invalidate_master_context();

drop trigger if exists eos_action_commands_invalidate_twin_v34
  on public.eos_action_commands;
drop trigger if exists eos_action_commands_invalidate_twin_terminal_v74
  on public.eos_action_commands;
drop trigger if exists eos_action_commands_invalidate_twin_delete_v74
  on public.eos_action_commands;

create trigger eos_action_commands_invalidate_twin_terminal_v74
after update of estado on public.eos_action_commands
for each row
when (
  old.estado is distinct from new.estado
  and new.estado in ('completada', 'error', 'no_disponible', 'cancelada')
)
execute function public.eos_invalidate_business_twin_v34();

create trigger eos_action_commands_invalidate_twin_delete_v74
after delete on public.eos_action_commands
for each row
execute function public.eos_invalidate_business_twin_v34();

comment on trigger eos_action_commands_invalidate_master_context_terminal
  on public.eos_action_commands is
  'RC1 v74: command plumbing does not stale Contexto Maestro; only terminal business outcomes do.';
comment on trigger eos_action_commands_invalidate_twin_terminal_v74
  on public.eos_action_commands is
  'RC1 v74: command plumbing does not stale Business Twin; only terminal business outcomes do.';

commit;
