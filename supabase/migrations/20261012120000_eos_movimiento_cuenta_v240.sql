-- Vincular cada movimiento a una cuenta real, PR A de la secuencia.
--
-- Hoy `eos_finanzas_cuentas` (personal) y `eos_empresa_cajas_v120` (negocio)
-- son solo un saldo que la persona declara a mano, sin ningún lazo con los
-- movimientos reales que EOS ya registra. Esta migración agrega el lazo:
-- dos columnas nullable, una por tabla de destino, porque esas dos tablas
-- son distintas a propósito (personal cuelga de `usuario_id`, negocio de
-- `empresa_id` — mezclarlas cruzaría la frontera que separa a un empleado
-- invitado de la cuenta personal de su jefe, ver
-- `20260904140000_eos_empresa_cajas_v120.sql`).
--
-- `ambito` ya distingue 'personal'/'negocio' en las dos tablas desde la
-- v136/v143, así que el check de abajo usa el mismo criterio: solo la
-- columna que corresponde al ámbito de la fila puede estar cargada.
--
-- No crea ninguna cuenta y no reasigna movimientos viejos: "sin cuenta
-- asignada" (NULL) es un resultado válido, no un error. Adivinar la cuenta
-- de un movimiento histórico sería inventar un dato — lo que la doctrina del
-- proyecto evita en otros lados (`destinos.ts`: "antes sin reconocer que una
-- mentira").

alter table public.eos_movimientos_financieros
  add column if not exists cuenta_id uuid references public.eos_finanzas_cuentas(id) on delete set null,
  add column if not exists caja_id uuid references public.eos_empresa_cajas_v120(id) on delete set null;

alter table public.eos_movimientos_financieros
  drop constraint if exists eos_movimientos_cuenta_segun_ambito;
alter table public.eos_movimientos_financieros
  add constraint eos_movimientos_cuenta_segun_ambito check (
    (cuenta_id is null or ambito = 'personal') and
    (caja_id is null or ambito = 'negocio')
  );

create index if not exists eos_movimientos_cuenta_idx
  on public.eos_movimientos_financieros (cuenta_id) where cuenta_id is not null;
create index if not exists eos_movimientos_caja_idx
  on public.eos_movimientos_financieros (caja_id) where caja_id is not null;

comment on column public.eos_movimientos_financieros.cuenta_id is
  'A qué eos_finanzas_cuentas (personal) pertenece. NULL = sin cuenta asignada, válido.';
comment on column public.eos_movimientos_financieros.caja_id is
  'A qué eos_empresa_cajas_v120 (negocio) pertenece. NULL = sin caja asignada, válido.';

-- ============================================================
-- Resolver de cuenta (personal), extraído del mismo criterio de
-- coincidencia que ya usa eos_finanzas_declarar_saldo_v149: exacta gana;
-- si no hay exacta, busca parecidas por nombre/institución; más de una
-- parecida no elige, informa con EOS_ACCION_CUENTA_AMBIGUA; ninguna
-- coincidencia devuelve NULL — a diferencia de DECLARAR_SALDO, acá "no la
-- reconozco" es un resultado válido, nunca crea una cuenta nueva.
-- ============================================================
create or replace function public.eos_resolver_cuenta_v240(
  p_usuario_id uuid,
  p_nombre text,
  p_moneda text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_nombre text;
  v_moneda text;
  v_id uuid;
  v_cuantas integer := 0;
  v_parecidas text;
begin
  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is null then
    return null;
  end if;

  v_moneda := upper(nullif(btrim(coalesce(p_moneda, '')), ''));
  if v_moneda is not null and length(v_moneda) <> 3 then
    v_moneda := null;
  end if;

  -- Exacta primero, y gana aunque haya parecidas.
  select c.id into v_id
  from public.eos_finanzas_cuentas c
  where c.usuario_id = p_usuario_id
    and c.ambito = 'personal'
    and c.activa
    and lower(c.nombre) = lower(v_nombre)
    and (v_moneda is null or c.moneda = v_moneda)
  order by c.created_at
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select count(*) into v_cuantas
  from public.eos_finanzas_cuentas c
  where c.usuario_id = p_usuario_id
    and c.ambito = 'personal'
    and c.activa
    and (v_moneda is null or c.moneda = v_moneda)
    and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
         or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%');

  -- Con más de una parecida no se elige: una cuenta equivocada deja mal el
  -- saldo de las dos al mismo tiempo, y nadie lo nota mirando.
  if v_cuantas > 1 then
    select string_agg(c.nombre, ', ' order by c.nombre) into v_parecidas
    from public.eos_finanzas_cuentas c
    where c.usuario_id = p_usuario_id
      and c.ambito = 'personal'
      and c.activa
      and (v_moneda is null or c.moneda = v_moneda)
      and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
           or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%');

    raise exception 'EOS_ACCION_CUENTA_AMBIGUA: %', v_parecidas;
  end if;

  if v_cuantas = 1 then
    select c.id into v_id
    from public.eos_finanzas_cuentas c
    where c.usuario_id = p_usuario_id
      and c.ambito = 'personal'
      and c.activa
      and (v_moneda is null or c.moneda = v_moneda)
      and (lower(c.nombre) like '%' || lower(v_nombre) || '%'
           or lower(coalesce(c.institucion, '')) like '%' || lower(v_nombre) || '%')
    limit 1;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.eos_resolver_cuenta_v240(uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_resolver_cuenta_v240(uuid, text, text) to service_role;

comment on function public.eos_resolver_cuenta_v240(uuid, text, text) is
  'v240: resuelve un nombre dicho por la persona a una eos_finanzas_cuentas.id (ambito personal). Exacta gana; con dos parecidas no elige, tira EOS_ACCION_CUENTA_AMBIGUA; sin coincidencia devuelve NULL. Nunca crea una cuenta.';

-- ============================================================
-- Resolver de caja (negocio), mismo criterio contra
-- eos_empresa_cajas_v120.
-- ============================================================
create or replace function public.eos_resolver_caja_v240(
  p_empresa_id uuid,
  p_nombre text,
  p_moneda text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_nombre text;
  v_moneda text;
  v_id uuid;
  v_cuantas integer := 0;
  v_parecidas text;
begin
  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is null then
    return null;
  end if;

  v_moneda := upper(nullif(btrim(coalesce(p_moneda, '')), ''));
  if v_moneda is not null and length(v_moneda) <> 3 then
    v_moneda := null;
  end if;

  select c.id into v_id
  from public.eos_empresa_cajas_v120 c
  where c.empresa_id = p_empresa_id
    and c.activa
    and lower(c.nombre) = lower(v_nombre)
    and (v_moneda is null or c.moneda = v_moneda)
  order by c.creado_en
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select count(*) into v_cuantas
  from public.eos_empresa_cajas_v120 c
  where c.empresa_id = p_empresa_id
    and c.activa
    and (v_moneda is null or c.moneda = v_moneda)
    and lower(c.nombre) like '%' || lower(v_nombre) || '%';

  if v_cuantas > 1 then
    select string_agg(c.nombre, ', ' order by c.nombre) into v_parecidas
    from public.eos_empresa_cajas_v120 c
    where c.empresa_id = p_empresa_id
      and c.activa
      and (v_moneda is null or c.moneda = v_moneda)
      and lower(c.nombre) like '%' || lower(v_nombre) || '%';

    raise exception 'EOS_ACCION_CAJA_AMBIGUA: %', v_parecidas;
  end if;

  if v_cuantas = 1 then
    select c.id into v_id
    from public.eos_empresa_cajas_v120 c
    where c.empresa_id = p_empresa_id
      and c.activa
      and (v_moneda is null or c.moneda = v_moneda)
      and lower(c.nombre) like '%' || lower(v_nombre) || '%'
    limit 1;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.eos_resolver_caja_v240(uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_resolver_caja_v240(uuid, text, text) to service_role;

comment on function public.eos_resolver_caja_v240(uuid, text, text) is
  'v240: resuelve un nombre dicho por la persona a una eos_empresa_cajas_v120.id. Mismo criterio que eos_resolver_cuenta_v240, del lado del negocio.';
