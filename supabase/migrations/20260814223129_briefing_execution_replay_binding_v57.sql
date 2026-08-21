-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

create or replace function public.eos_guard_daily_briefing_enrichment_v38()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution text := btrim(coalesce(new.execution_id, ''));
  v_order bigint;
  v_existing_payload jsonb;
  v_existing_model text;
  v_existing_prompt text;
begin
  if v_execution = '' or v_execution !~ '^[0-9]+$' then raise exception 'EOS_BRIEFING_EXECUTION_ID_INVALID'; end if;
  begin v_order := v_execution::bigint;
  exception when numeric_value_out_of_range then raise exception 'EOS_BRIEFING_EXECUTION_ID_INVALID'; end;

  v_execution := v_order::text;
  new.execution_id := v_execution;
  new.execution_order := v_order;
  new.model_version := btrim(new.model_version);
  new.prompt_version := btrim(new.prompt_version);
  new.apply_status := 'pending';
  new.skip_reason := null;
  new.applied_at := null;

  perform pg_advisory_xact_lock(hashtextextended('eos-briefing:' || new.usuario_id::text || ':' || new.briefing_date::text, 0));

  select e.payload, e.model_version, e.prompt_version
    into v_existing_payload, v_existing_model, v_existing_prompt
  from public.eos_daily_briefing_enrichments e
  where e.usuario_id = new.usuario_id
    and e.briefing_date = new.briefing_date
    and e.execution_id = v_execution
  limit 1;

  if found then
    if v_existing_payload is distinct from new.payload
      or btrim(v_existing_model) is distinct from new.model_version
      or btrim(v_existing_prompt) is distinct from new.prompt_version then
      raise exception 'EOS_BRIEFING_EXECUTION_CONFLICT';
    end if;
    return null;
  end if;

  if exists (
    select 1 from public.eos_daily_briefing_enrichments e
    where e.usuario_id = new.usuario_id
      and e.briefing_date = new.briefing_date
      and e.apply_status = 'applied'
      and e.execution_order is not null
      and e.execution_order > v_order
  ) then
    new.apply_status := 'skipped';
    new.skip_reason := 'newer_execution_already_applied';
  end if;

  return new;
end;
$$;

revoke all on function public.eos_guard_daily_briefing_enrichment_v38() from public, anon, authenticated;
grant execute on function public.eos_guard_daily_briefing_enrichment_v38() to service_role;
comment on function public.eos_guard_daily_briefing_enrichment_v38() is
  'RC1 v57: serializa enriquecimientos por usuario/dia, normaliza execution_id a decimal canonico, vincula replays a payload/model/prompt exactos y evita last-finisher-wins.';
