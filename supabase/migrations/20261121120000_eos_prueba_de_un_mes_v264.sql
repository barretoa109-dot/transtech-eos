-- v264: un mes de prueba del plan Full al crear la cuenta.
--
-- ============================================================
-- POR QUÉ
-- ============================================================
--
-- En la simulación de 100 clientes (21/11/2026), cinco de los que quedaban en
-- "quizás" decían lo mismo: "quiero probarlo antes de pagar". Con 10 mensajes
-- por día no alcanzan a ver a EOS llevándoles el negocio. El dueño aprobó dar
-- un mes del plan pago al crear la cuenta, sin tarjeta.
--
-- Es Full y no Emprendedor porque al crear la cuenta todavía no sabemos si la
-- persona viene por su plata o por su negocio: que pruebe todo y elija.
--
-- No choca con "todo plan tiene tope": es una prueba que vence a los 30 días,
-- con el mismo tramo de conversaciones (y el mismo aviso interno de consumo)
-- que el plan pago. Al vencer, la cuenta queda en el plan Gratis sola: los
-- módulos vencen por fecha y `eos_tiene_modulo` ya mira el vencimiento.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- 1) `eos_dar_prueba_v264(usuario)`: activa los módulos del plan `full`
--    (`eos_paquetes`, v263) por 30 días con origen `prueba`. Una sola vez por
--    cuenta: si la cuenta ya tuvo cualquier módulo (pago, cortesía, prueba),
--    no hace nada.
-- 2) Trigger en `auth.users`: cada cuenta nueva recibe la prueba. Va envuelto
--    en un bloque de excepción: si algo falla, la cuenta se crea igual, sin
--    prueba. Una alta que falla es peor que una prueba que falta.
-- 3) Las cuentas que existen y nunca tuvieron un módulo también la reciben.
-- 4) `eos_plan_efectivo_v228` cuenta los módulos de prueba vigentes para el
--    cupo de mensajes, igual que los pagos. Sin esto, quien prueba Full seguiría
--    con los 10 mensajes por día del plan Gratis. Las cortesías siguen sin
--    contar, por el mismo motivo de la v228.
--
-- Si la persona paga durante la prueba, `eos_activar_modulo` suma los días
-- pagos a los que le quedaban de prueba y cambia el origen a `pago`: no pierde
-- nada por pagar antes.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
--
--   drop trigger if exists eos_prueba_al_nacer on auth.users;
--   drop function if exists public.eos_prueba_al_nacer_v264();
--   drop function if exists public.eos_dar_prueba_v264(uuid);
--   y volver a crear eos_plan_efectivo_v228 desde la v228 (origen = 'pago').
--   Las pruebas ya dadas vencen solas a los 30 días.

-- ============================================================
-- 1) Dar la prueba
-- ============================================================

create or replace function public.eos_dar_prueba_v264(p_usuario_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modulos text[];
  v_codigo text;
begin
  if p_usuario_id is null then
    return false;
  end if;

  -- Una sola vez: cualquier fila de módulos, de cualquier origen y aunque
  -- esté vencida, quiere decir que esta cuenta ya tuvo su oportunidad.
  if exists (select 1 from public.eos_usuario_modulos where usuario_id = p_usuario_id) then
    return false;
  end if;

  select modulos into v_modulos
  from public.eos_paquetes
  where codigo = 'full' and activo;

  if v_modulos is null then
    return false;
  end if;

  foreach v_codigo in array v_modulos loop
    -- Un módulo apagado del catálogo se saltea: el resto de la prueba sirve.
    if exists (select 1 from public.eos_modulos where codigo = v_codigo and activo) then
      perform public.eos_activar_modulo(p_usuario_id, v_codigo, 30, 'prueba', null);
    end if;
  end loop;

  return true;
end;
$$;

comment on function public.eos_dar_prueba_v264(uuid) is
  'Activa los módulos del plan Full por 30 días con origen prueba (v264). Una sola vez por cuenta.';

revoke all on function public.eos_dar_prueba_v264(uuid) from public;
revoke all on function public.eos_dar_prueba_v264(uuid) from anon, authenticated;
grant execute on function public.eos_dar_prueba_v264(uuid) to service_role;

-- ============================================================
-- 2) Cada cuenta nueva
-- ============================================================

create or replace function public.eos_prueba_al_nacer_v264()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.eos_dar_prueba_v264(new.id);
  exception when others then
    raise warning 'EOS v264: no se pudo dar la prueba a %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.eos_prueba_al_nacer_v264() from public;
revoke all on function public.eos_prueba_al_nacer_v264() from anon, authenticated;

drop trigger if exists eos_prueba_al_nacer on auth.users;
create trigger eos_prueba_al_nacer
  after insert on auth.users
  for each row
  execute function public.eos_prueba_al_nacer_v264();

-- ============================================================
-- 3) Las cuentas que ya existen y nunca tuvieron un módulo
-- ============================================================

do $$
declare
  v_id uuid;
  v_dadas integer := 0;
begin
  for v_id in
    select u.id
    from auth.users u
    where not exists (select 1 from public.eos_usuario_modulos um where um.usuario_id = u.id)
  loop
    if public.eos_dar_prueba_v264(v_id) then
      v_dadas := v_dadas + 1;
    end if;
  end loop;

  raise notice 'v264: prueba dada a % cuentas existentes.', v_dadas;
end $$;

-- ============================================================
-- 4) La prueba cuenta para el cupo de mensajes
-- ============================================================
--
-- Mismo cuerpo que la v228; la única diferencia es `origen in ('pago',
-- 'prueba')` en lugar de `origen = 'pago'`.

create or replace function public.eos_plan_efectivo_v228(p_usuario_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_modulo text;
begin
  select p.codigo into v_base
  from public.usuarios u
  join public.planes p on p.codigo = lower(coalesce(u.plan, 'free')) and p.activo = true
  where u.id = p_usuario_id;

  if v_base is null then
    return null;
  end if;

  if v_base <> 'free' and not public.eos_suscripcion_vigente_internal_v1(p_usuario_id) then
    v_base := 'free';
  end if;

  select p.codigo into v_modulo
  from public.eos_usuario_modulos um
  join public.eos_modulos m on m.codigo = um.modulo_codigo and m.plan_equivalente is not null
  join public.planes p on p.codigo = m.plan_equivalente and p.activo = true
  where um.usuario_id = p_usuario_id
    and um.estado = 'activo'
    and um.origen in ('pago', 'prueba')
    and um.vencimiento is not null
    and um.vencimiento > now()
  order by case when p.limite_mensajes is null or p.limite_mensajes < 0
                then 2147483647 else p.limite_mensajes end desc
  limit 1;

  if v_modulo is null or v_modulo = v_base then
    return v_base;
  end if;

  if v_base = 'free' then
    return v_modulo;
  end if;

  -- Dos planes pagos: el que más mensajes da (sin tope gana).
  return (
    select p.codigo
    from public.planes p
    where p.codigo in (v_base, v_modulo)
    order by case when p.limite_mensajes is null or p.limite_mensajes < 0
                  then 2147483647 else p.limite_mensajes end desc
    limit 1
  );
end;
$$;

revoke all on function public.eos_plan_efectivo_v228(uuid) from public;
revoke all on function public.eos_plan_efectivo_v228(uuid) from anon, authenticated;
grant execute on function public.eos_plan_efectivo_v228(uuid) to service_role;

comment on function public.eos_plan_efectivo_v228(uuid) is
  'Plan con el que cuenta la persona hoy: el de la cuenta (free si venció) o el de un tramo de conversaciones pago o de prueba y vigente, el mayor (v264). Las cortesías no cuentan.';
