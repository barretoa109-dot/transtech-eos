begin;

revoke insert, update, delete
on table public.eos_intelligence_score_snapshots_v10
from authenticated;

drop policy if exists eos_intelligence_score_insert_own
  on public.eos_intelligence_score_snapshots_v10;
drop policy if exists eos_intelligence_score_update_own
  on public.eos_intelligence_score_snapshots_v10;

-- Users keep read access to their own score history through the existing
-- eos_intelligence_score_select_own policy. Mutations are performed only by
-- the authenticated server route through service_role after auth.getUser().
grant select, insert, update, delete
on table public.eos_intelligence_score_snapshots_v10
to service_role;

comment on table public.eos_intelligence_score_snapshots_v10 is
  'EOS Intelligence Score history. v47: authenticated users may read own snapshots; writes are server-only to prevent forged score history.';

commit;
