-- ============================================================
-- v197 · Que nadie se pueda dar un plan pago desde la consola del navegador,
--        y que las 40 tablas heredadas tengan RLS en el repositorio
-- ============================================================
--
-- QUÉ SE ENCONTRÓ (auditoría Production GO, 24/09/2026)
--
-- Se reconstruyó la base desde cero con las 293 migraciones sobre un Postgres
-- con los roles de Supabase (anon, authenticated, service_role) y se midió el
-- catálogo resultante. Tres cosas:
--
-- 1. CUARENTA tablas de `public` quedan SIN Row Level Security. Son las del
--    esquema heredado (v0): `usuarios`, `mensajes`, `memorias`, `objetivos`,
--    `solicitudes_pago`, `uso_mensual`, `eventos_pago`... Varias tienen
--    políticas escritas en migraciones posteriores —`solicitudes_pago`,
--    `tareas`, `eos_profiles`— pero ninguna migración las ENCIENDE: eso se
--    hizo a mano en el panel de Supabase. Con los privilegios por defecto de
--    la v0 (anon y authenticated reciben ALL en toda tabla nueva), en la base
--    reconstruida cualquiera con la clave pública podía leer los correos y
--    planes de todos los usuarios y escribir `usuarios.plan`.
--
--    En producción probablemente no es así (el código del chat da por hecho
--    las políticas de `mensajes`), pero NO SE PUEDE COMPROBAR desde el
--    repositorio, y el runbook de recuperación (reconstruir desde las
--    migraciones) entregaría una base abierta. Un plan de recuperación que
--    abre la base no es un plan de recuperación.
--
-- 2. `usuarios` es la fuente de verdad del plan (`obtener_estado_comercial_eos`
--    lee `plan`, `plan_vencimiento` y `estado_suscripcion` de ahí) y el
--    navegador escribe en esa misma tabla (RegisterForm hace un upsert). No
--    hay ninguna migración que diga qué columnas puede tocar el usuario. Si la
--    política de producción es la clásica "cada uno actualiza su fila", un
--    usuario gratuito se asigna un plan pago con una línea en la consola:
--
--      supabase.from('usuarios').update({ plan: 'pro',
--        plan_vencimiento: '2099-01-01' }).eq('id', miId)
--
--    Esto se corrige acá sin depender de cómo estén las políticas en
--    producción: un trigger que, cuando quien escribe es `authenticated` o
--    `anon`, conserva las columnas comerciales tal como estaban. Todo cambio
--    legítimo de plan pasa por funciones SECURITY DEFINER (corren como su
--    dueño) o por service_role, que no se ven afectados.
--
-- 3. `eos_action_approvals_v12`: el usuario puede actualizar sus aprobaciones
--    (así las aprueba o rechaza desde el panel) y el permiso de tabla cubría
--    TODAS las columnas. Ya estaba cubierto: el trigger
--    `eos_guard_user_approval_update_v12` rechaza cualquier cambio que no sea
--    la decisión. Se acota igual el permiso a `status`, para que la regla no
--    dependa de un solo mecanismo.
--
-- CÓMO ES SEGURA DE APLICAR EN PRODUCCIÓN
--
-- * `enable row level security` es idempotente: donde ya está prendida no
--   cambia nada.
-- * Las políticas de dueño se crean SOLO en tablas que no tienen ninguna. Si
--   producción ya tiene las suyas (hechas en el panel), se respetan.
-- * Las tablas de plata y de consumo (`solicitudes_pago`, `historial_pagos`,
--   `uso_mensual`, `eventos_pago`) quedan de solo lectura para el usuario:
--   la app las escribe siempre con service_role o por RPC. Sin esto, un
--   usuario podía poner su propio `uso_mensual` en cero.
-- * `anon` pierde todo salvo leer `planes` (la página de precios) e insertar
--   en `leads` (el formulario de la landing).
--
-- Probado en una reconstrucción local con dos usuarios: ver
-- supabase/pruebas/aislamiento_rls_e2e.sql.

-- ------------------------------------------------------------
-- 1) Columnas comerciales de `usuarios`: solo el servidor las cambia
-- ------------------------------------------------------------

create or replace function public.eos_usuarios_proteger_comercial_v197()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user es el rol efectivo. PostgREST hace SET ROLE authenticated/anon;
  -- dentro de una función SECURITY DEFINER es su dueño, y service_role es
  -- service_role. Solo los dos primeros son "el navegador".
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan := 'free';
    -- Los mismos valores que los defaults de la columna.
    new.plan_inicio := now();
    new.plan_vencimiento := null;
    new.estado_suscripcion := 'active';
    new.proveedor_pago := 'manual';
    new.ultimo_pago := null;
    new.cancelar_al_vencimiento := false;
    new.metadata_suscripcion := '{}'::jsonb;
    return new;
  end if;

  new.id := old.id;
  new.plan := old.plan;
  new.plan_inicio := old.plan_inicio;
  new.plan_vencimiento := old.plan_vencimiento;
  new.estado_suscripcion := old.estado_suscripcion;
  new.proveedor_pago := old.proveedor_pago;
  new.ultimo_pago := old.ultimo_pago;
  new.cancelar_al_vencimiento := old.cancelar_al_vencimiento;
  new.metadata_suscripcion := old.metadata_suscripcion;
  new.created_at := old.created_at;
  return new;
end;
$$;

comment on function public.eos_usuarios_proteger_comercial_v197() is
  'v197: el plan, su vigencia y el estado de la suscripción solo los cambia el servidor (service_role o funciones SECURITY DEFINER). Lo que venga del navegador en esas columnas se ignora.';

revoke all on function public.eos_usuarios_proteger_comercial_v197() from public, anon, authenticated;

drop trigger if exists usuarios_proteger_comercial_v197 on public.usuarios;
create trigger usuarios_proteger_comercial_v197
before insert or update on public.usuarios
for each row execute function public.eos_usuarios_proteger_comercial_v197();

-- ------------------------------------------------------------
-- 2) RLS en las tablas heredadas
-- ------------------------------------------------------------

do $$
declare
  -- Tablas con dueño: el usuario ve y edita SOLO lo suyo.
  v_propias text[] := array[
    'actividad_reciente', 'contexto_usuario', 'dashboard_ia', 'diagnosticos',
    'documentos_generados', 'eos_actions', 'eos_activity', 'eos_contexto',
    'eos_dashboard_metrics', 'eos_documents', 'eos_finance_records',
    'eos_historial', 'eos_intelligence', 'eos_kpis', 'eos_memory',
    'eos_notifications', 'eos_profiles', 'eos_projects', 'eos_tendencias',
    'eos_workspace_items', 'memorias', 'mensajes', 'notificaciones',
    'objetivos', 'recomendaciones', 'score_historico', 'score_usuario',
    'seguimientos', 'tareas'
  ];
  -- Plata y consumo: el usuario solo LEE lo suyo. Se escriben con service_role.
  v_solo_lectura text[] := array['solicitudes_pago', 'historial_pagos', 'uso_mensual'];
  -- Catálogo público: cualquiera lo lee, nadie lo escribe desde el cliente.
  v_catalogo text[] := array['planes', 'funciones_eos', 'permisos_plan'];
  -- Solo servidor.
  v_internas text[] := array['clientes', 'perfiles', 'eventos_pago'];
  v_tabla text;
  v_col text;
  v_expr text;
begin
  foreach v_tabla in array v_propias || v_solo_lectura || v_catalogo || v_internas || array['usuarios', 'leads'] loop
    if to_regclass('public.' || v_tabla) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on table public.%I from anon', v_tabla);
  end loop;

  -- Dueño, con la columna y el tipo que tenga cada tabla (hay uuid y text).
  foreach v_tabla in array v_propias || v_solo_lectura loop
    if to_regclass('public.' || v_tabla) is null then
      continue;
    end if;

    select a.attname into v_col
    from pg_attribute a
    where a.attrelid = ('public.' || v_tabla)::regclass
      and a.attname in ('usuario_id', 'user_id')
      and a.attnum > 0 and not a.attisdropped
    order by a.attname = 'usuario_id' desc
    limit 1;

    if v_col is null then
      continue;
    end if;

    if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
        where a.attrelid = ('public.' || v_tabla)::regclass and a.attname = v_col) = 'uuid' then
      v_expr := format('%I = (select auth.uid())', v_col);
    else
      v_expr := format('%I = ((select auth.uid()))::text', v_col);
    end if;

    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_tabla) then
      execute format('create policy %I on public.%I for select to authenticated using (%s)',
        v_tabla || '_select_propias_v197', v_tabla, v_expr);

      if v_tabla = any (v_propias) then
        execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
          v_tabla || '_insert_propias_v197', v_tabla, v_expr);
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
          v_tabla || '_update_propias_v197', v_tabla, v_expr, v_expr);
        execute format('create policy %I on public.%I for delete to authenticated using (%s)',
          v_tabla || '_delete_propias_v197', v_tabla, v_expr);
      end if;
    end if;

    if v_tabla = any (v_solo_lectura) then
      execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', v_tabla);
    end if;
  end loop;

  foreach v_tabla in array v_catalogo loop
    if to_regclass('public.' || v_tabla) is null then
      continue;
    end if;
    execute format('revoke insert, update, delete, truncate on table public.%I from authenticated', v_tabla);
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_tabla) then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
        v_tabla || '_lectura_publica_v197', v_tabla);
    end if;
  end loop;

  foreach v_tabla in array v_internas loop
    if to_regclass('public.' || v_tabla) is not null then
      execute format('revoke all on table public.%I from authenticated', v_tabla);
    end if;
  end loop;
end;
$$;

-- La landing (app/page.tsx) guarda el formulario de contacto sin sesión.
grant select on table public.planes to anon;
grant insert on table public.leads to anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leads') then
    create policy leads_insert_publico_v197 on public.leads
      for insert to anon, authenticated with check (true);
  end if;
end;
$$;

-- `usuarios`: cada uno lee, crea y edita su fila. Las columnas comerciales las
-- protege el trigger de arriba; nadie borra su fila desde el cliente (la baja
-- pasa por /api/cuenta/eliminar).
revoke delete, truncate on table public.usuarios from authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'usuarios') then
    create policy usuarios_select_propia_v197 on public.usuarios
      for select to authenticated using (id = (select auth.uid()));
    create policy usuarios_insert_propia_v197 on public.usuarios
      for insert to authenticated with check (id = (select auth.uid()));
    create policy usuarios_update_propia_v197 on public.usuarios
      for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) Aprobaciones: el cliente solo decide, no reescribe la orden
-- ------------------------------------------------------------

revoke update on table public.eos_action_approvals_v12 from authenticated;
grant update (status) on table public.eos_action_approvals_v12 to authenticated;
