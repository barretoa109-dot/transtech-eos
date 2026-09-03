-- Cuenta corriente: vencimientos y pagos parciales (v107).
--
-- ============================================================
-- QUÉ FALTABA
-- ============================================================
--
-- Hoy `condicion = 'credito'` significa solamente "todavía no cobrado". No hay
-- vencimiento, así que nadie puede saber si una factura está atrasada; y no
-- hay pagos parciales, así que un cliente que abona la mitad obliga a elegir
-- entre marcar la venta como cobrada —y decir que entró plata que no entró— o
-- dejarla sin cobrar y perder el registro de lo que sí pagó.
--
-- Las dos cosas juntas son lo que impide calcular DSO, DPO y antigüedad de
-- cartera, que son los indicadores con los que se maneja el crédito.
--
-- ============================================================
-- POR QUÉ UNA TABLA Y NO MÁS COLUMNAS
-- ============================================================
--
-- Un `saldo_pendiente` en la cabecera sería más rápido de leer y mentiría el
-- día que alguien lo actualice sin registrar el pago. Cada cobro es un HECHO
-- —una fecha, un monto, una plata que se movió— y los hechos van en filas.
-- El saldo se deriva; lo que se guarda es lo que pasó.
--
-- ============================================================
-- LA REGLA QUE NO SE NEGOCIA
-- ============================================================
--
-- Cada cobranza crea SU movimiento financiero. La plata que entra al negocio
-- entra una vez y por un solo camino. Sin esto, la cuenta corriente y el panel
-- financiero contarían dos historias distintas de la misma plata, que es
-- exactamente el error que este proyecto ya pagó con el margen.

-- ============================================================
-- 1. Vencimiento
-- ============================================================
--
-- Nullable: las ventas al contado no vencen, y las de crédito ya cargadas no
-- tienen con qué completarlo hacia atrás. Un default inventado (30 días)
-- llenaría la cartera de vencimientos que nadie pactó.

alter table public.eos_erp_ventas add column if not exists vence_el date;
alter table public.eos_erp_compras add column if not exists vence_el date;

comment on column public.eos_erp_ventas.vence_el is
  'v107: cuándo vence la venta a crédito. Null = sin plazo pactado o venta al contado.';
comment on column public.eos_erp_compras.vence_el is
  'v107: cuándo vence la compra a crédito. Null = sin plazo pactado o compra al contado.';

-- ============================================================
-- 2. Los cobros y pagos parciales
-- ============================================================

create table if not exists public.eos_erp_cuenta_movimientos_v107 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- Pertenece a una venta O a una compra, nunca a las dos y nunca a ninguna.
  venta_id uuid references public.eos_erp_ventas(id) on delete restrict,
  compra_id uuid references public.eos_erp_compras(id) on delete restrict,
  -- Escrito así y no con `num_nonnulls` para usar la misma forma que ya tiene
  -- `eos_erp_anulaciones_auditoria` (v88): dos maneras de decir lo mismo en el
  -- mismo esquema obligan a leer las dos para saber si dicen lo mismo.
  constraint eos_cuenta_mov_documento_xor check (
    (venta_id is not null and compra_id is null)
    or (venta_id is null and compra_id is not null)
  ),

  monto numeric(16, 2) not null check (monto > 0),
  moneda text not null,
  fecha date not null,

  -- El movimiento financiero que este cobro generó. `restrict` a propósito:
  -- borrar el movimiento por su lado dejaría una cobranza apuntando al vacío.
  movimiento_id uuid references public.eos_movimientos_financieros(id) on delete restrict,

  nota text,
  creado_en timestamptz not null default now()
);

comment on table public.eos_erp_cuenta_movimientos_v107 is
  'v107: cada cobro o pago parcial contra una venta o una compra. El saldo se deriva de acá, no se guarda.';

create index if not exists eos_cuenta_mov_venta_idx
  on public.eos_erp_cuenta_movimientos_v107 (venta_id) where venta_id is not null;
create index if not exists eos_cuenta_mov_compra_idx
  on public.eos_erp_cuenta_movimientos_v107 (compra_id) where compra_id is not null;
create index if not exists eos_cuenta_mov_usuario_idx
  on public.eos_erp_cuenta_movimientos_v107 (usuario_id, fecha desc);

alter table public.eos_erp_cuenta_movimientos_v107 enable row level security;

drop policy if exists eos_cuenta_mov_propio on public.eos_erp_cuenta_movimientos_v107;
create policy eos_cuenta_mov_propio
  on public.eos_erp_cuenta_movimientos_v107
  for select to authenticated
  using ((select auth.uid()) = usuario_id);

-- La regla del proyecto: toda tabla con datos de una persona le revoca todo a
-- `anon`. Y la escritura es del servidor: quien cobra pasa por la función, que
-- es la que garantiza que el movimiento financiero se cree en la misma
-- transacción.
revoke all on table public.eos_erp_cuenta_movimientos_v107 from public, anon, authenticated;
grant select on table public.eos_erp_cuenta_movimientos_v107 to authenticated;
grant all on table public.eos_erp_cuenta_movimientos_v107 to service_role;

-- ============================================================
-- 3. El saldo de un documento
-- ============================================================

create or replace function public.eos_erp_saldo_documento_v107(
  p_venta_id uuid default null,
  p_compra_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (select v.total from public.eos_erp_ventas v where v.id = p_venta_id),
      (select c.total from public.eos_erp_compras c where c.id = p_compra_id),
      0
    )
    -
    coalesce((
      select sum(m.monto)
      from public.eos_erp_cuenta_movimientos_v107 m
      where (p_venta_id is not null and m.venta_id = p_venta_id)
         or (p_compra_id is not null and m.compra_id = p_compra_id)
    ), 0);
$$;

revoke all on function public.eos_erp_saldo_documento_v107(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_erp_saldo_documento_v107(uuid, uuid) to service_role;

-- ============================================================
-- 4. Registrar un cobro o un pago parcial
-- ============================================================

create or replace function public.eos_erp_registrar_cobranza_v107(
  p_usuario_id uuid,
  p_venta_id uuid default null,
  p_compra_id uuid default null,
  p_monto numeric default null,
  p_fecha date default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric;
  v_moneda text;
  v_estado text;
  v_contacto uuid;
  v_saldo numeric;
  v_movimiento_id uuid;
  v_cobranza_id uuid;
  v_fecha date;
  v_es_venta boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not (
    (p_venta_id is not null and p_compra_id is null)
    or (p_venta_id is null and p_compra_id is not null)
  ) then
    raise exception 'EOS_COBRANZA_DOCUMENTO_INVALIDO';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'EOS_COBRANZA_MONTO_INVALIDO';
  end if;

  -- NaN e Infinity pasan el `> 0` y arruinan toda suma posterior. Mismo
  -- control que ya hace el ajuste de stock.
  if p_monto = 'NaN'::numeric or p_monto = 'Infinity'::numeric then
    raise exception 'EOS_COBRANZA_MONTO_INVALIDO';
  end if;

  v_es_venta := p_venta_id is not null;
  v_fecha := coalesce(p_fecha, public.eos_hoy_py());

  -- Se bloquea la cabecera: dos cobros simultáneos del mismo documento
  -- podrían pasar los dos el control de saldo y dejar el documento sobrecobrado.
  if v_es_venta then
    select total, moneda, estado, contacto_id
      into v_total, v_moneda, v_estado, v_contacto
    from public.eos_erp_ventas
    where id = p_venta_id and usuario_id = p_usuario_id
    for update;
  else
    select total, moneda, estado, contacto_id
      into v_total, v_moneda, v_estado, v_contacto
    from public.eos_erp_compras
    where id = p_compra_id and usuario_id = p_usuario_id
    for update;
  end if;

  if not found then
    raise exception 'EOS_DOCUMENTO_NO_EXISTE';
  end if;

  if v_estado = 'anulada' then
    raise exception 'EOS_DOCUMENTO_ANULADO';
  end if;

  v_saldo := public.eos_erp_saldo_documento_v107(p_venta_id, p_compra_id);

  if v_saldo <= 0 then
    raise exception 'EOS_DOCUMENTO_SIN_SALDO';
  end if;

  -- Cobrar de más no es un redondeo: es plata que no corresponde a este
  -- documento y que después nadie va a saber de dónde salió.
  if p_monto > v_saldo then
    raise exception 'EOS_COBRANZA_EXCEDE_SALDO';
  end if;

  insert into public.eos_movimientos_financieros (
    usuario_id, tipo, monto, moneda, descripcion, categoria, fecha, origen, metadata
  ) values (
    p_usuario_id,
    case when v_es_venta then 'ingreso' else 'gasto' end,
    p_monto,
    v_moneda,
    case when v_es_venta then 'Cobro de venta' else 'Pago de compra' end
      || coalesce(' — ' || (
        select c.nombre from public.eos_crm_contactos c where c.id = v_contacto
      ), '')
      || case when p_monto < v_saldo then ' (parcial)' else '' end,
    case when v_es_venta then 'ventas' else 'compras' end,
    v_fecha,
    'erp',
    jsonb_build_object('venta_id', p_venta_id, 'compra_id', p_compra_id, 'parcial', p_monto < v_saldo)
  )
  returning id into v_movimiento_id;

  insert into public.eos_erp_cuenta_movimientos_v107 (
    usuario_id, venta_id, compra_id, monto, moneda, fecha, movimiento_id, nota
  ) values (
    p_usuario_id, p_venta_id, p_compra_id, p_monto, v_moneda, v_fecha, v_movimiento_id, p_nota
  )
  returning id into v_cobranza_id;

  -- Con el saldo en cero el documento queda saldado. `movimiento_id` de la
  -- cabecera se deja NULL a propósito: no hay un movimiento único que
  -- represente el cobro, y apuntarlo al último sería mentir sobre el resto.
  if v_saldo - p_monto = 0 then
    if v_es_venta then
      update public.eos_erp_ventas set estado = 'cobrada', actualizado_en = now() where id = p_venta_id;
    else
      update public.eos_erp_compras set estado = 'pagada', actualizado_en = now() where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cobranza_id', v_cobranza_id,
    'movimiento_id', v_movimiento_id,
    'monto', p_monto,
    'saldo_anterior', v_saldo,
    'saldo_actual', v_saldo - p_monto,
    'saldado', v_saldo - p_monto = 0
  );
end;
$$;

revoke all on function public.eos_erp_registrar_cobranza_v107(uuid, uuid, uuid, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_cobranza_v107(uuid, uuid, uuid, numeric, date, text)
  to service_role;

-- ============================================================
-- 5. Revertir un cobro mal cargado
-- ============================================================
--
-- Hace falta por dos razones. Una: cargar 500.000 donde iban 50.000 es un
-- error de tipeo normal y sin esto no habría forma de arreglarlo. La otra: el
-- punto 6 bloquea anular un documento con cobranzas, así que sin una salida
-- el bloqueo sería una trampa.
--
-- Borra el movimiento financiero junto con la cobranza: la plata no entró, y
-- dejarla en el panel financiero sería peor que el error original.

create or replace function public.eos_erp_revertir_cobranza_v107(
  p_usuario_id uuid,
  p_cobranza_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cobranza public.eos_erp_cuenta_movimientos_v107%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_cobranza
  from public.eos_erp_cuenta_movimientos_v107
  where id = p_cobranza_id and usuario_id = p_usuario_id
  for update;

  if not found then
    raise exception 'EOS_COBRANZA_NO_EXISTE';
  end if;

  delete from public.eos_erp_cuenta_movimientos_v107 where id = p_cobranza_id;

  if v_cobranza.movimiento_id is not null then
    delete from public.eos_movimientos_financieros
    where id = v_cobranza.movimiento_id and usuario_id = p_usuario_id;
  end if;

  -- El documento vuelve a estar pendiente: si estaba saldado, ya no lo está.
  if v_cobranza.venta_id is not null then
    update public.eos_erp_ventas
    set estado = 'emitida', actualizado_en = now()
    where id = v_cobranza.venta_id and estado = 'cobrada';
  else
    update public.eos_erp_compras
    set estado = 'registrada', actualizado_en = now()
    where id = v_cobranza.compra_id and estado = 'pagada';
  end if;

  return jsonb_build_object('ok', true, 'cobranza_id', p_cobranza_id);
end;
$$;

revoke all on function public.eos_erp_revertir_cobranza_v107(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_erp_revertir_cobranza_v107(uuid, uuid) to service_role;

-- ============================================================
-- 6. No se anula un documento con plata ya cobrada
-- ============================================================
--
-- Si un cliente pagó 500.000 de una venta de 1.000.000, esa plata ENTRÓ. Al
-- anular la venta, borrar el cobro haría desaparecer un hecho real y dejaría
-- el panel financiero por debajo de la caja verdadera; no borrarlo dejaría un
-- ingreso huérfano apuntando a una venta anulada.
--
-- Las dos salidas son malas, así que no se elige ninguna: se bloquea, y el
-- usuario decide primero qué pasa con la plata (revertir el cobro si fue un
-- error, o dejar la venta viva si el cobro fue real).
--
-- Va como trigger y no reescribiendo `eos_erp_anular_venta`: esas funciones
-- fueron redefinidas cinco veces entre v78 y v92 y la v102 las reescribió en
-- vivo. Tocarlas otra vez es la forma más segura de deshacer algo sin
-- enterarse. Mismo criterio que la v93.

create or replace function public.eos_erp_bloquear_anulacion_con_cobranzas_v107()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cobranzas int;
begin
  if new.estado <> 'anulada' or old.estado = 'anulada' then
    return new;
  end if;

  select count(*) into v_cobranzas
  from public.eos_erp_cuenta_movimientos_v107 m
  where (tg_table_name = 'eos_erp_ventas' and m.venta_id = new.id)
     or (tg_table_name = 'eos_erp_compras' and m.compra_id = new.id);

  if v_cobranzas > 0 then
    raise exception 'EOS_DOCUMENTO_CON_COBRANZAS'
      using hint = 'Revertí primero los cobros o pagos registrados contra este documento.';
  end if;

  return new;
end;
$$;

drop trigger if exists eos_erp_ventas_bloquear_anulacion on public.eos_erp_ventas;
create trigger eos_erp_ventas_bloquear_anulacion
  before update of estado on public.eos_erp_ventas
  for each row
  execute function public.eos_erp_bloquear_anulacion_con_cobranzas_v107();

drop trigger if exists eos_erp_compras_bloquear_anulacion on public.eos_erp_compras;
create trigger eos_erp_compras_bloquear_anulacion
  before update of estado on public.eos_erp_compras
  for each row
  execute function public.eos_erp_bloquear_anulacion_con_cobranzas_v107();

-- ============================================================
-- 7. Cobrar el total sigue funcionando, y ahora cobra el SALDO
-- ============================================================
--
-- `eos_erp_cobrar_venta` y `eos_erp_pagar_compra` son las que usa el botón
-- "Confirmar" de la pantalla y las acciones del chat. Se conservan tal cual
-- por afuera —misma firma, mismo nombre— y por adentro pasan a delegar en la
-- cobranza, cobrando lo que falta en vez del total.
--
-- Sin esto, cobrar el total de una venta que ya tenía un pago parcial
-- registraría el importe COMPLETO otra vez y el usuario vería entrar plata que
-- nunca existió.
--
-- Ojo con la fecha: la v102 reescribió estas funciones cambiando
-- `current_date` por `eos_hoy_py()` porque una venta de las diez de la noche
-- se registraba con fecha de mañana. Acá se usa `eos_hoy_py()` para no
-- deshacer ese arreglo.

create or replace function public.eos_erp_cobrar_venta(
  p_usuario_id uuid,
  p_venta_id uuid,
  p_fecha date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta public.eos_erp_ventas%rowtype;
  v_saldo numeric;
  v_resultado jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_venta
  from public.eos_erp_ventas
  where id = p_venta_id and usuario_id = p_usuario_id
  for update;

  if not found then raise exception 'EOS_VENTA_NO_EXISTE'; end if;
  if v_venta.estado = 'anulada' then raise exception 'EOS_VENTA_ANULADA'; end if;

  -- Idempotencia. Se mira el ESTADO además del movimiento: una venta saldada
  -- a fuerza de pagos parciales queda 'cobrada' con `movimiento_id` en null, y
  -- mirando solo el movimiento se la cobraría de nuevo entera.
  if v_venta.movimiento_id is not null or v_venta.estado = 'cobrada' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true,
      'venta_id', v_venta.id, 'movimiento_id', v_venta.movimiento_id
    );
  end if;

  v_saldo := public.eos_erp_saldo_documento_v107(p_venta_id, null);
  if v_saldo <= 0 then
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'venta_id', v_venta.id);
  end if;

  v_resultado := public.eos_erp_registrar_cobranza_v107(
    p_usuario_id, p_venta_id, null, v_saldo, coalesce(p_fecha, public.eos_hoy_py()), null
  );

  -- Cuando el cobro fue por el total de una vez, la cabecera conserva su
  -- `movimiento_id` como siempre: hay código y auditoría que lo leen.
  if not exists (
    select 1 from public.eos_erp_cuenta_movimientos_v107
    where venta_id = p_venta_id and id <> (v_resultado->>'cobranza_id')::uuid
  ) then
    update public.eos_erp_ventas
    set movimiento_id = (v_resultado->>'movimiento_id')::uuid
    where id = p_venta_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false,
    'venta_id', v_venta.id,
    'movimiento_id', (v_resultado->>'movimiento_id')::uuid
  );
end;
$$;

revoke all on function public.eos_erp_cobrar_venta(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.eos_erp_cobrar_venta(uuid, uuid, date) to service_role;

create or replace function public.eos_erp_pagar_compra(
  p_usuario_id uuid,
  p_compra_id uuid,
  p_fecha date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compra public.eos_erp_compras%rowtype;
  v_saldo numeric;
  v_resultado jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_compra
  from public.eos_erp_compras
  where id = p_compra_id and usuario_id = p_usuario_id
  for update;

  if not found then raise exception 'EOS_COMPRA_NO_EXISTE'; end if;
  if v_compra.estado = 'anulada' then raise exception 'EOS_COMPRA_ANULADA'; end if;

  if v_compra.movimiento_id is not null or v_compra.estado = 'pagada' then
    return jsonb_build_object(
      'ok', true, 'ya_estaba', true,
      'compra_id', v_compra.id, 'movimiento_id', v_compra.movimiento_id
    );
  end if;

  v_saldo := public.eos_erp_saldo_documento_v107(null, p_compra_id);
  if v_saldo <= 0 then
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'compra_id', v_compra.id);
  end if;

  v_resultado := public.eos_erp_registrar_cobranza_v107(
    p_usuario_id, null, p_compra_id, v_saldo, coalesce(p_fecha, public.eos_hoy_py()), null
  );

  if not exists (
    select 1 from public.eos_erp_cuenta_movimientos_v107
    where compra_id = p_compra_id and id <> (v_resultado->>'cobranza_id')::uuid
  ) then
    update public.eos_erp_compras
    set movimiento_id = (v_resultado->>'movimiento_id')::uuid
    where id = p_compra_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'ya_estaba', false,
    'compra_id', v_compra.id,
    'movimiento_id', (v_resultado->>'movimiento_id')::uuid
  );
end;
$$;

revoke all on function public.eos_erp_pagar_compra(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.eos_erp_pagar_compra(uuid, uuid, date) to service_role;
