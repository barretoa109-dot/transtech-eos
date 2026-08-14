create or replace function public.eos_snapshot_business_twin_v28()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.eos_business_twin_snapshots_v14 (
    usuario_id,
    version,
    source_fingerprint,
    snapshot,
    confidence,
    source_completeness,
    generated_at
  )
  values (
    new.usuario_id,
    new.version,
    new.source_fingerprint,
    jsonb_build_object(
      'model_version', new.model_version,
      'identity', new.identity,
      'current_state', new.current_state,
      'desired_state', new.desired_state,
      'gaps', new.gaps,
      'constraints', new.constraints,
      'capabilities', new.capabilities,
      'risks', new.risks,
      'opportunities', new.opportunities,
      'priorities', new.priorities,
      'execution_profile', new.execution_profile,
      'learning_profile', new.learning_profile,
      'autonomy_profile', new.autonomy_profile,
      'intelligence_score', new.intelligence_score
    ),
    new.confidence,
    new.source_completeness,
    new.generated_at
  )
  on conflict (usuario_id, version) do nothing;

  return new;
end;
$$;

revoke all on function public.eos_snapshot_business_twin_v28() from public, anon, authenticated;
grant execute on function public.eos_snapshot_business_twin_v28() to service_role;

create or replace function public.eos_ignore_identical_twin_snapshot_v28()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.eos_business_twin_snapshots_v14 existing
    where existing.usuario_id = new.usuario_id
      and existing.version = new.version
      and existing.source_fingerprint = new.source_fingerprint
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.eos_ignore_identical_twin_snapshot_v28() from public, anon, authenticated;
grant execute on function public.eos_ignore_identical_twin_snapshot_v28() to service_role;

drop trigger if exists eos_business_twin_snapshot_v28 on public.eos_business_twins_v14;
create trigger eos_business_twin_snapshot_v28
after insert or update of version on public.eos_business_twins_v14
for each row
execute function public.eos_snapshot_business_twin_v28();

drop trigger if exists eos_business_twin_snapshot_idempotency_v28 on public.eos_business_twin_snapshots_v14;
create trigger eos_business_twin_snapshot_idempotency_v28
before insert on public.eos_business_twin_snapshots_v14
for each row
execute function public.eos_ignore_identical_twin_snapshot_v28();
