begin;

create or replace function public.eos_preserve_score_calculated_at_v23()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.score,
    new.contexto,
    new.objetivos,
    new.ejecucion,
    new.decisiones,
    new.aprendizaje,
    new.active_goals,
    new.pending_alerts,
    new.critical_alerts,
    new.completed_actions,
    new.measured_decisions,
    new.learning_evidence,
    new.strongest_dimension,
    new.weakest_dimension,
    new.formula_version
  ) is not distinct from row(
    old.score,
    old.contexto,
    old.objetivos,
    old.ejecucion,
    old.decisiones,
    old.aprendizaje,
    old.active_goals,
    old.pending_alerts,
    old.critical_alerts,
    old.completed_actions,
    old.measured_decisions,
    old.learning_evidence,
    old.strongest_dimension,
    old.weakest_dimension,
    old.formula_version
  ) then
    new.calculated_at := old.calculated_at;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_preserve_score_calculated_at_v23()
  from public, anon, authenticated;
grant execute on function public.eos_preserve_score_calculated_at_v23()
  to service_role;

drop trigger if exists eos_score_semantic_calculated_at_v23
  on public.eos_intelligence_score_snapshots_v10;

create trigger eos_score_semantic_calculated_at_v23
before update on public.eos_intelligence_score_snapshots_v10
for each row
execute function public.eos_preserve_score_calculated_at_v23();

comment on function public.eos_preserve_score_calculated_at_v23() is
  'Conserva calculated_at cuando un upsert del mismo snapshot no cambia contenido semántico; evita versiones espurias del Business Twin.';

commit;