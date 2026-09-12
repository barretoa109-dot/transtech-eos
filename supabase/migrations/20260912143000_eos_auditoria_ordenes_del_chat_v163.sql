-- EOS — La bitácora inmutable no sabía nada de lo que EOS hace desde el chat (v163)
--
-- ============================================================
-- LO QUE SE ENCONTRÓ, MEDIDO CONTRA PRODUCCIÓN EL 12/09/2026
-- ============================================================
--
-- `eos_auditoria_v60` está sana: 249 filas en 9 cadenas, cero huecos, cero
-- eslabones desenganchados y cero sellos rotos, recalculados uno por uno con
-- `eos_auditoria_hash_v60`. Los dos triggers están activos y `service_role`
-- solo tiene SELECT e INSERT.
--
-- Y de esas 249 filas, 208 salieron del correo, 40 del panel y 1 del sistema.
-- **Del chat, ninguna.** En el mismo período EOS completó 64 órdenes pedidas
-- en el chat —ventas, compras, cobros, saldos, deudas— y no quedó asentada
-- una sola.
--
-- No fue una decisión. `lib/auditoria/registrar.ts` ya preveía el caso
-- —`OperacionErp.origen` admite "chat", "si lo pidió EOS"— pero ningún camino
-- lo escribe: las rutas del panel llaman a `registrarOperacionErp`, y las
-- órdenes del chat las ejecuta `eos_execute_internal_effect_v64` y las cierra
-- `eos_finalize_action_command_v70`, en SQL, donde nadie llamó a nada.
--
-- Hasta el 6 de septiembre quedaba al menos el TAP: el nivel por defecto era
-- 2, cada acción pedía aprobación, y `app/api/autonomy/approvals/[id]` asentaba
-- "Autorizaste la acción X". Con el nivel 3 por defecto EOS ejecuta solo —que
-- es lo que el usuario pidió— y desde entonces la bitácora que se le muestra a
-- un auditor no registra ninguna de las cosas que EOS hizo por su cuenta.
--
-- ============================================================
-- UN TRIGGER, NO VEINTITRÉS LLAMADAS
-- ============================================================
--
-- Una orden llega a su estado final por más de un camino: el cierre del
-- worker (`action-results/v1`), el del gateway de la aplicación, y el claim
-- que la da por perdida cuando se agotan los intentos. Asentar en cada uno
-- garantiza que el día que aparezca un cuarto camino, ese no asiente.
--
-- Por eso se asienta donde pasan todos: el cambio de `estado`. Con la misma
-- condición que ya usan los dos triggers vecinos
-- (`eos_action_commands_invalidate_master_context_terminal` y
-- `eos_action_commands_invalidate_twin_terminal_v74`): solo cuando el estado
-- CAMBIA a uno terminal. Un cierre idempotente no cambia nada y no deja una
-- segunda fila.
--
-- ============================================================
-- QUÉ SE ASIENTA
-- ============================================================
--
--   · `completada`, `error` y `no_disponible`. Lo que falló también: la línea
--     que más se consulta de una bitácora es la que explica por qué algo NO
--     pasó. Es la regla de `registrarOperacionErp`, que manda `resultado`
--     aunque sea "error".
--   · `cancelada`, no: ahí no se intentó nada, y el rechazo de una persona ya
--     lo asienta la ruta de aprobaciones.
--   · Las operaciones del ERP usan SU evento —una venta del chat es un
--     `venta_registrada`, igual que una del panel—, así que "todas las ventas
--     que se registraron" las trae vengan de donde vengan. Lo demás usa
--     `accion_ejecutada`, que se agrega acá.
--   · `referencia` es la entidad que se tocó —el `effect_id` que devuelve el
--     ejecutor, que para una venta es el id de la venta—, igual que en las
--     filas del panel. Si no hubo efecto, la orden.
--
-- ============================================================
-- LO QUE NO SE ASIENTA, A PROPÓSITO
-- ============================================================
--
-- **El payload.** Trae `mensaje`, que es el texto literal que escribió la
-- persona, y `datos`, que es lo que entendió el modelo. `limpiarDetalle`
-- prohíbe lo primero por nombre, y acá se cumple la regla de la forma más
-- estricta: no se copia nada del payload. Solo ids, el código de error y el
-- tipo de efecto.
--
-- **El `error_message`**, por lo mismo: es texto libre y puede traer nombres
-- de terceros. El `error_code` alcanza para investigar.
--
-- ============================================================
-- NUNCA ABORTA LA ORDEN
-- ============================================================
--
-- Mismo criterio que `registrarAuditoria`: si el asiento falla, la orden
-- cierra igual y el fallo queda como WARNING en el log de Postgres. Al revés
-- sería peor: una venta ya hecha figuraría como fallida porque no se pudo
-- escribir su renglón, y el worker la reintentaría.
--
-- ============================================================
-- LAS 64 QUE YA PASARON NO SE RELLENAN
-- ============================================================
--
-- El sello pone `created_at := now()` sin excepción, y es correcto que lo
-- haga: si quien escribe pudiera elegir la fecha, podría antedatar. Entonces
-- rellenar hoy las órdenes del 10 de septiembre las dejaría fechadas el 12 en
-- un registro que no se puede corregir nunca. Un hueco documentado es mejor
-- que una fecha falsa en una bitácora inmutable. Las órdenes siguen en
-- `eos_action_commands` con su fecha verdadera.

-- ============================================================
-- 1) El evento nuevo.
--
-- La lista es la viva al 12/09/2026, leída con `pg_get_constraintdef`, más
-- `accion_ejecutada` al final. Se reescribe entera como en v98, v105 y v116.
-- ============================================================
alter table public.eos_auditoria_v60
  drop constraint if exists eos_auditoria_v60_evento_check;

alter table public.eos_auditoria_v60
  add constraint eos_auditoria_v60_evento_check
  check (evento = any (array[
    'correo_recibido', 'movimiento_ingerido', 'movimiento_descartado', 'movimiento_confirmado',
    'accion_autorizada', 'accion_rechazada', 'datos_exportados', 'conciliacion_registrada',
    'venta_registrada', 'venta_cobrada', 'venta_anulada', 'venta_editada',
    'compra_registrada', 'compra_pagada', 'compra_anulada', 'compra_editada',
    'stock_ajustado', 'producto_modificado', 'comprobante_emitido', 'costo_corregido',
    'accion_ejecutada'
  ]::text[]));

comment on constraint eos_auditoria_v60_evento_check on public.eos_auditoria_v60 is
  'v163: se suma accion_ejecutada, lo que EOS ejecutó desde el chat y no es una operación del ERP. Las del ERP usan su propio evento, vengan del panel o del chat.';

-- ============================================================
-- 2) Asentar cada orden del chat al llegar a su estado final.
-- ============================================================
create or replace function public.eos_auditoria_orden_del_chat_v163()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento text;
  v_hizo text;
  v_hacer text;
  v_resumen text;
  v_origen text;
begin
  -- Lo que no toca datos no se asienta: contestar o mostrar un tablero.
  if new.accion in ('RESPONDER', 'VER_DASHBOARD', 'VER_BRIEFING') then
    return new;
  end if;

  /*
   * Un renglón por acción: su evento, qué hizo y qué intentó hacer.
   *
   * `lib/auditoria/ordenes-del-chat.test.ts` lee esta lista y falla si una
   * acción que el worker ejecuta no tiene renglón, si una del ERP no usa su
   * evento, o si una frase no está conjugada como las demás.
   */
  select m.evento, m.hizo, m.hacer
  into v_evento, v_hizo, v_hacer
  from (values
    ('REGISTRAR_VENTA', 'venta_registrada', 'registró una venta', 'registrar una venta'),
    ('ANULAR_VENTA', 'venta_anulada', 'anuló una venta', 'anular una venta'),
    ('CORREGIR_VENTA', 'venta_editada', 'corrigió una venta', 'corregir una venta'),
    ('REGISTRAR_COBRO', 'venta_cobrada', 'registró un cobro', 'registrar un cobro'),
    ('REGISTRAR_COMPRA', 'compra_registrada', 'registró una compra', 'registrar una compra'),
    ('REGISTRAR_PAGO_COMPRA', 'compra_pagada', 'registró un pago a un proveedor', 'registrar un pago a un proveedor'),
    ('AJUSTAR_STOCK', 'stock_ajustado', 'ajustó el stock de un producto', 'ajustar el stock de un producto'),
    ('CREAR_PRODUCTO', 'producto_modificado', 'cargó productos al catálogo', 'cargar productos al catálogo'),
    ('ACTUALIZAR_PRODUCTO', 'producto_modificado', 'actualizó productos del catálogo', 'actualizar productos del catálogo'),
    ('CREAR_CONTACTO', 'accion_ejecutada', 'agendó un contacto', 'agendar un contacto'),
    ('REGISTRAR_OPORTUNIDAD', 'accion_ejecutada', 'anotó una oportunidad', 'anotar una oportunidad'),
    ('REGISTRAR_MOVIMIENTO_PERSONAL', 'accion_ejecutada', 'anotó movimientos de la plata personal', 'anotar movimientos de la plata personal'),
    ('CORREGIR_MOVIMIENTO', 'accion_ejecutada', 'corrigió un movimiento', 'corregir un movimiento'),
    ('REGISTRAR_TRANSFERENCIA', 'accion_ejecutada', 'anotó una transferencia entre cuentas propias', 'anotar una transferencia entre cuentas propias'),
    ('DECLARAR_SALDO', 'accion_ejecutada', 'actualizó el saldo de una cuenta', 'actualizar el saldo de una cuenta'),
    ('REGISTRAR_DEUDA', 'accion_ejecutada', 'anotó una deuda', 'anotar una deuda'),
    ('REGISTRAR_PAGO_DEUDA', 'accion_ejecutada', 'anotó el pago de una cuota', 'anotar el pago de una cuota'),
    ('REGISTRAR_GASTO_FIJO', 'accion_ejecutada', 'anotó gastos fijos', 'anotar gastos fijos'),
    ('REGISTRAR_TARJETA', 'accion_ejecutada', 'anotó una tarjeta', 'anotar una tarjeta'),
    ('REGISTRAR_COMPRA_TARJETA', 'accion_ejecutada', 'anotó una compra con tarjeta', 'anotar una compra con tarjeta'),
    ('CREAR_TAREA', 'accion_ejecutada', 'creó una tarea', 'crear una tarea'),
    ('CREAR_OBJETIVO', 'accion_ejecutada', 'creó un objetivo', 'crear un objetivo'),
    ('GUARDAR_MEMORIA', 'accion_ejecutada', 'guardó un dato en la memoria', 'guardar un dato en la memoria'),
    ('GENERAR_EXCEL', 'accion_ejecutada', 'generó una planilla', 'generar una planilla'),
    ('GENERAR_PDF', 'accion_ejecutada', 'generó un PDF', 'generar un PDF'),
    ('GENERAR_WORD', 'accion_ejecutada', 'generó un documento', 'generar un documento')
  ) as m(accion, evento, hizo, hacer)
  where m.accion = new.accion;

  -- Una acción nueva sin renglón se asienta igual, con su nombre de máquina.
  -- Queda fea, pero queda: una lista que se quedó atrás no puede ser la razón
  -- de que algo no conste.
  v_evento := coalesce(v_evento, 'accion_ejecutada');
  v_hizo := coalesce(v_hizo, 'ejecutó la acción ' || new.accion);
  v_hacer := coalesce(v_hacer, 'ejecutar la acción ' || new.accion);

  -- Las órdenes que dejaron las pruebas no se hacen pasar por conversaciones:
  -- ni en el origen ni en el resumen. La primera versión decía "Desde el chat"
  -- también para ellas, y se vio probándola antes de aplicarla.
  v_origen := case
    when new.origen = 'prueba' or new.origen like 'qa-%' then 'sistema'
    else 'chat'
  end;

  v_resumen := (case when v_origen = 'chat' then 'Desde el chat' else 'En una prueba del sistema' end)
    || case new.estado
      when 'completada' then ', EOS ' || v_hizo || '.'
      when 'no_disponible' then ', EOS no pudo ' || v_hacer || ': la acción no estaba disponible.'
      else ', EOS intentó ' || v_hacer || ' y no pudo.'
    end;

  begin
    insert into public.eos_auditoria_v60 (
      usuario_id, evento, origen, resumen, detalle, referencia, empresa_id
    ) values (
      new.usuario_id,
      v_evento,
      v_origen,
      v_resumen,
      jsonb_strip_nulls(jsonb_build_object(
        'accion', new.accion,
        'resultado', case when new.estado = 'completada' then 'ok' else new.estado end,
        'orden', new.id::text,
        'request_id', new.request_id::text,
        'mensaje_id', new.mensaje_id::text,
        'intentos', new.attempt_count,
        'error_code', new.error_code,
        'efecto', new.resultado ->> 'effect_type',
        'origen_orden', new.origen
      )),
      coalesce(
        case when new.estado = 'completada' then nullif(new.resultado ->> 'effect_id', '') end,
        new.id::text
      ),
      -- Metadata de consulta, fuera del hash (v123). Solo en lo que es del ERP.
      case when v_evento <> 'accion_ejecutada' then public.eos_empresa_de_v109(new.usuario_id) end
    );
  exception when others then
    raise warning 'AUDITORIA: no se pudo asentar la orden % (%): %', new.id, new.accion, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.eos_auditoria_orden_del_chat_v163() is
  'v163: asienta en eos_auditoria_v60 cada orden del chat que llega a completada, error o no_disponible. Nunca aborta la orden. Sin payload ni error_message.';

drop trigger if exists eos_action_commands_auditoria_v163 on public.eos_action_commands;
create trigger eos_action_commands_auditoria_v163
  after update of estado on public.eos_action_commands
  for each row
  when (old.estado is distinct from new.estado
        and new.estado = any (array['completada', 'error', 'no_disponible']::text[]))
  execute function public.eos_auditoria_orden_del_chat_v163();

revoke all on function public.eos_auditoria_orden_del_chat_v163() from public, anon, authenticated;

-- ============================================================
-- 3) La salud de TODAS las cadenas, para quien opera.
--
-- `eos_auditoria_verificar_v60()` recorre la cadena de `auth.uid()`: la de
-- quien pregunta. Sirve para la persona, y no contesta "¿están sanas todas?"
-- sin iniciar sesión como cada una. El 12/09 hubo que escribir esa consulta a
-- mano para saberlo; esta es la misma consulta, con los permisos y los
-- triggers adentro, para `service_role` y nadie más.
--
-- Recalcula cada sello con la MISMA `eos_auditoria_hash_v60` que usan el sello
-- y la verificación: una segunda definición del hash podría decir "todo bien"
-- sobre una cadena que ya no calza.
-- ============================================================
create or replace function public.eos_auditoria_salud_v163()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select
      a.usuario_id,
      a.numero,
      a.hash,
      a.hash_previo,
      a.origen,
      row_number() over (partition by a.usuario_id order by a.numero) as posicion,
      coalesce(lag(a.hash) over (partition by a.usuario_id order by a.numero), 'GENESIS') as previo_esperado,
      public.eos_auditoria_hash_v60(
        a.numero, a.usuario_id, a.evento, a.origen, a.resumen,
        a.detalle, a.referencia, a.created_at, a.hash_previo
      ) as sello_esperado
    from public.eos_auditoria_v60 as a
  )
  select jsonb_build_object(
    'filas', (select count(*) from c),
    'cadenas', (select count(distinct c.usuario_id) from c),
    'filas_del_chat', (select count(*) from c where c.origen = 'chat'),
    'huecos', (select count(*) from c where c.numero <> c.posicion),
    'desenganches', (select count(*) from c where c.hash_previo <> c.previo_esperado),
    'sellos_rotos', (select count(*) from c where c.hash <> c.sello_esperado),
    'trigger_sellar', exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.eos_auditoria_v60'::regclass
        and t.tgname = 'eos_auditoria_sellar_trg' and t.tgenabled = 'O'
    ),
    'trigger_solo_agregar', exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.eos_auditoria_v60'::regclass
        and t.tgname = 'eos_auditoria_solo_agregar_trg' and t.tgenabled = 'O'
    ),
    'trigger_ordenes_del_chat', exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.eos_action_commands'::regclass
        and t.tgname = 'eos_action_commands_auditoria_v163' and t.tgenabled = 'O'
    ),
    'service_role_puede_reescribir',
      has_table_privilege('service_role', 'public.eos_auditoria_v60', 'UPDATE')
      or has_table_privilege('service_role', 'public.eos_auditoria_v60', 'DELETE')
      or has_table_privilege('service_role', 'public.eos_auditoria_v60', 'TRUNCATE'),
    'authenticated_puede_escribir',
      has_table_privilege('authenticated', 'public.eos_auditoria_v60', 'INSERT')
      or has_table_privilege('authenticated', 'public.eos_auditoria_v60', 'UPDATE')
      or has_table_privilege('authenticated', 'public.eos_auditoria_v60', 'DELETE'),
    'anon_puede_leer', has_table_privilege('anon', 'public.eos_auditoria_v60', 'SELECT')
  );
$$;

comment on function public.eos_auditoria_salud_v163() is
  'v163: recalcula todas las cadenas de eos_auditoria_v60 y revisa triggers y permisos. Solo service_role.';

revoke all on function public.eos_auditoria_salud_v163() from public, anon, authenticated;
grant execute on function public.eos_auditoria_salud_v163() to service_role;
