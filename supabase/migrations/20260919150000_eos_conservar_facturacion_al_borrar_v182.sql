-- "Eliminar mi cuenta" ya no borra los registros de facturación que la ley obliga a conservar.
--
-- ============================================================
-- LA CONTRADICCIÓN QUE SE ENCONTRÓ
-- ============================================================
--
-- La política de privacidad publicada (/privacidad, "Cuánto tiempo los
-- guardamos") dice: "Si la eliminás, tus datos se borran de forma inmediata e
-- irreversible. Conservamos únicamente los registros de facturación que la ley
-- nos obliga a mantener". Pero `eos_borrar_mis_datos_v55` borra TODA tabla con
-- `usuario_id`, y `solicitudes_pago` e `historial_pagos` (los cobros de EOS,
-- 10 pagos acreditados al 2026-09-19) además tienen `on delete cascade` hacia
-- `auth.users`. O sea: quien eliminaba su cuenta se llevaba consigo los
-- comprobantes de lo que había pagado, y TransTech perdía el respaldo contable
-- de un cobro real. El texto publicado y el comportamiento no coincidían.
--
-- Se corrige el comportamiento, no el texto: es lo que la política dice y lo
-- que obliga a hacer una obligación de conservar registros de facturación.
--
-- ============================================================
-- QUÉ SE CONSERVA, Y QUÉ NO
-- ============================================================
--
-- Antes de borrar, la función copia a `eos_registros_facturacion_conservados_v182`
-- los cobros ACREDITADOS, REEMBOLSADOS o REVERTIDOS (los que son un hecho
-- contable), con solo los campos de un registro de facturación: quién pagó
-- (nombre y correo del momento), qué plan, cuánto, cuándo, con qué proveedor y
-- las referencias del cobro. NO se copia el `metadata` libre, ni las solicitudes
-- pendientes, vencidas o rechazadas (no son un cobro), ni nada de conversaciones,
-- documentos o finanzas de la persona.
--
-- La tabla nueva no tiene columna `usuario_id` ni `user_id`, a propósito: el
-- borrado y la exportación recorren el catálogo buscando esos nombres, y así no
-- la alcanzan. Solo se enlaza con la cuenta por un hash (`cuenta_ref`).
--
-- ============================================================
-- LO QUE ESTA MIGRACIÓN NO DECIDE
-- ============================================================
--
-- * Cuánto tiempo se conservan estos registros. La ley paraguaya fija un plazo
--   para los comprobantes; NO es una decisión técnica y no se inventa uno acá.
--   Es parte de la revisión legal pendiente (punto 9 de la lista maestra).
-- * Las facturas electrónicas de quien usa el módulo de Facturación
--   (`eos_fe_documentos`, `eos_fe_secuencias`, `eos_fe_config`): hoy hay 0
--   documentos y el módulo no está habilitado, pero cuando lo esté, borrar la
--   cuenta del emisor borra también su numeración fiscal. Hay que decidirlo
--   antes de activar la facturación real (ver docs/privacidad-retencion-de-datos.md).
--
-- `create or replace` conserva los permisos de la función. La tabla nace abierta
-- a anon por los default privileges de la v0: se revoca de forma explícita.

create table if not exists public.eos_registros_facturacion_conservados_v182 (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('solicitud_pago', 'historial_pago')),
  origen_id uuid not null,
  cuenta_ref text not null,
  titular_nombre text,
  titular_email text,
  plan_codigo text not null,
  periodicidad text not null,
  monto bigint not null,
  moneda text not null,
  proveedor text not null,
  referencia_interna text,
  referencia_externa text,
  estado text not null,
  pagado_at timestamptz,
  creado_at timestamptz not null,
  conservado_en timestamptz not null default now(),
  motivo text not null default 'obligación legal de conservar registros de facturación',
  unique (origen, origen_id)
);

alter table public.eos_registros_facturacion_conservados_v182 enable row level security;

revoke all on table public.eos_registros_facturacion_conservados_v182
  from public, anon, authenticated;
grant select on table public.eos_registros_facturacion_conservados_v182 to service_role;

comment on table public.eos_registros_facturacion_conservados_v182 is
  'Copia mínima de cobros conservados al eliminar una cuenta (obligación legal). Sin usuario_id a propósito. Solo service_role lee.';

CREATE OR REPLACE FUNCTION public.eos_borrar_mis_datos_v55()
 RETURNS TABLE(tabla text, filas_borradas bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_usuario uuid := auth.uid();
  r record;
  n bigint;
  pendientes text[] := '{}';
  intento int := 0;
  hubo_error boolean;
  ultimo_error text;
begin
  if v_usuario is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Único caso en que la bitácora de auditoría deja de ser append-only: ver
  -- la cabecera de esta migración y `eos_auditoria_solo_agregar_v60`. Local a
  -- esta transacción (tercer argumento `true`): no se escapa a otro código.
  perform set_config('eos.borrando_cuenta', 'true', true);

  -- Los registros de facturación que la ley obliga a conservar NO se borran con
  -- la cuenta: se copian, mínimos, a una tabla que no tiene `usuario_id` (y por eso
  -- el recorrido de abajo, que borra por ese nombre de columna, no la alcanza).
  -- Ver la migración v182.
  insert into public.eos_registros_facturacion_conservados_v182 (
    origen, origen_id, cuenta_ref, titular_nombre, titular_email,
    plan_codigo, periodicidad, monto, moneda, proveedor,
    referencia_interna, referencia_externa, estado, pagado_at, creado_at
  )
  select
    'solicitud_pago', s.id, encode(sha256(convert_to(v_usuario::text, 'UTF8')), 'hex'),
    u.nombre, u.email,
    s.plan_codigo, s.periodicidad, s.monto, s.moneda, s.proveedor,
    s.referencia_interna, s.referencia_externa, s.estado, s.pagado_at, s.created_at
  from public.solicitudes_pago s
  left join public.usuarios u on u.id = v_usuario
  where s.usuario_id = v_usuario
    and s.estado in ('pagado', 'reembolsado', 'reversado')
  on conflict (origen, origen_id) do nothing;

  insert into public.eos_registros_facturacion_conservados_v182 (
    origen, origen_id, cuenta_ref, titular_nombre, titular_email,
    plan_codigo, periodicidad, monto, moneda, proveedor,
    referencia_interna, referencia_externa, estado, pagado_at, creado_at
  )
  select
    'historial_pago', h.id, encode(sha256(convert_to(v_usuario::text, 'UTF8')), 'hex'),
    u.nombre, u.email,
    h.plan_codigo, h.periodicidad, h.monto, h.moneda, h.proveedor,
    null, h.referencia_externa, h.estado, h.pagado_at, h.created_at
  from public.historial_pagos h
  left join public.usuarios u on u.id = v_usuario
  where h.usuario_id = v_usuario
    and h.estado in ('pagado', 'reembolsado', 'reversado')
  on conflict (origen, origen_id) do nothing;


  -- Hasta 3 pasadas: algunas tablas se referencian entre sí (los chunks de un
  -- documento apuntan al documento), así que un borrado en orden arbitrario
  -- puede chocar con una clave foránea. Reintentar resuelve el orden sin
  -- tener que modelar el grafo de dependencias a mano.
  loop
    intento := intento + 1;
    hubo_error := false;

    for r in
      select c.table_name, c.column_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and t.table_type = 'BASE TABLE'
         and c.column_name in ('usuario_id', 'user_id')
         and (intento = 1 or c.table_name = any(pendientes))
       order by c.table_name
    loop
      begin
        -- El cast a text es necesario porque no todas las tablas guardan el
        -- id como uuid (`notificaciones.usuario_id` es text). Comparar como
        -- texto cubre las dos formas sin ramificar por tipo.
        execute format('delete from public.%I where %I::text = $1', r.table_name, r.column_name)
          using v_usuario::text;
        get diagnostics n = row_count;

        if n > 0 then
          tabla := r.table_name;
          filas_borradas := n;
          return next;
        end if;

        pendientes := array_remove(pendientes, r.table_name);
      exception
        when others then
          hubo_error := true;
          ultimo_error := sqlerrm;
          if not (r.table_name = any(pendientes)) then
            pendientes := array_append(pendientes, r.table_name);
          end if;
      end;
    end loop;

    exit when not hubo_error or intento >= 3;
  end loop;

  -- Si después de 3 pasadas algo sigue sin poder borrarse, se falla fuerte.
  -- Un borrado a medias es peor que ninguno: el usuario cree que sus datos se
  -- fueron y no es cierto.
  if array_length(pendientes, 1) > 0 then
    raise exception 'No se pudieron borrar las tablas: % (último error: %)',
      array_to_string(pendientes, ', '), ultimo_error;
  end if;

  -- `usuarios` va aparte: su columna es `id`, no `usuario_id`, así que el
  -- recorrido de arriba no la alcanza.
  delete from public.usuarios where id = v_usuario;
  get diagnostics n = row_count;
  if n > 0 then
    tabla := 'usuarios';
    filas_borradas := n;
    return next;
  end if;
end;
$function$;
