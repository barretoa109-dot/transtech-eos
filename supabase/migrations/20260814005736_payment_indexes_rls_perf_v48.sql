create index if not exists eventos_pago_solicitud_pago_id_idx
  on public.eventos_pago (solicitud_pago_id);

create index if not exists historial_pagos_solicitud_pago_id_idx
  on public.historial_pagos (solicitud_pago_id);

create index if not exists historial_pagos_usuario_id_idx
  on public.historial_pagos (usuario_id);

create index if not exists solicitudes_pago_plan_codigo_idx
  on public.solicitudes_pago (plan_codigo);

drop policy if exists "Usuario ve sus solicitudes" on public.solicitudes_pago;
create policy "Usuario ve sus solicitudes"
  on public.solicitudes_pago
  for select
  to authenticated
  using (usuario_id = (select auth.uid()));

drop policy if exists "Usuario ve sus pagos" on public.historial_pagos;
create policy "Usuario ve sus pagos"
  on public.historial_pagos
  for select
  to authenticated
  using (usuario_id = (select auth.uid()));
