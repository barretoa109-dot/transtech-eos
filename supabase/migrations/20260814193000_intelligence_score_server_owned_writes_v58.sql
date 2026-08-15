begin;

-- EOS Intelligence Score is a derived system metric. Authenticated users may
-- read their own history, but clients must not be able to forge snapshots.
revoke insert, update on table public.eos_intelligence_score_snapshots_v10
  from authenticated;

drop policy if exists eos_intelligence_score_insert_own
  on public.eos_intelligence_score_snapshots_v10;

drop policy if exists eos_intelligence_score_update_own
  on public.eos_intelligence_score_snapshots_v10;

-- Preserve authenticated read access through the existing own-row RLS policy.
grant select on table public.eos_intelligence_score_snapshots_v10
  to authenticated;

-- Persistence is performed only by trusted server code using service_role.
grant all on table public.eos_intelligence_score_snapshots_v10
  to service_role;

comment on table public.eos_intelligence_score_snapshots_v10 is
  'EOS Intelligence Score history. RC1 v58: authenticated users can read only their own snapshots; writes are server-owned via service_role.';

commit;