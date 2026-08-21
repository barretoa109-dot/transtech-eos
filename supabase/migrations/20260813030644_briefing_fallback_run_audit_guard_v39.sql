-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_guard_daily_briefing_fallback_run_v39()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generator text := coalesce(new.metadata ->> 'generator', '');
  v_briefing_model text;
  v_briefing_status text;
begin
  if v_generator <> 'fallback-v5' then
    return new;
  end if;

  select b.modelo_version, b.estado
    into v_briefing_model, v_briefing_status
  from public.eos_daily_briefings b
  where b.usuario_id = new.usuario_id
    and b.briefing_date = new.briefing_date;

  if found
     and coalesce(v_briefing_model, '') <> 'fallback-v5'
     and coalesce(v_briefing_status, '') <> 'error' then
    if tg_op = 'INSERT' then
      return null;
    end if;
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_guard_daily_briefing_fallback_run_v39()
  from public, anon, authenticated;
grant execute on function public.eos_guard_daily_briefing_fallback_run_v39()
  to service_role;

drop trigger if exists eos_daily_briefing_runs_fallback_guard_v39
  on public.eos_daily_briefing_runs;
create trigger eos_daily_briefing_runs_fallback_guard_v39
before insert or update on public.eos_daily_briefing_runs
for each row
execute function public.eos_guard_daily_briefing_fallback_run_v39();

comment on function public.eos_guard_daily_briefing_fallback_run_v39() is
  'RC1 v39: impide que un fallback omitido o concurrente etiquete el run como fallback cuando el briefing canonico ya pertenece a un generador superior.';
