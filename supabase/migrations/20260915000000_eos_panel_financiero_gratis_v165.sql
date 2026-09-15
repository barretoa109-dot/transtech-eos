-- EOS — el Panel financiero de Personal deja de ser un módulo pago.
--
-- ============================================================
-- LA PREGUNTA QUE LA v126 DEJÓ ABIERTA, A PROPÓSITO
-- ============================================================
--
-- La v126 retiró la cortesía del módulo `dashboard` ("Panel financiero") de
-- toda cuenta del plan gratuito, junto con los otros once módulos que un
-- `cross join` le había regalado por error. Su propio comentario final decía:
--
--   "Decidir si el panel financiero... tiene que venir de arranque para que
--   la cuenta gratuita sirva de algo es una decisión de producto y no de
--   esta migración."
--
-- Esa decisión se tomó ahora: el Panel financiero se regala a TODA cuenta,
-- de cualquier plan, para siempre. No es un accidente esta vez —es la
-- decisión explícita del dueño del producto, el 2026-09-15— y por eso el
-- riesgo que motivó la v126 (una cortesía masiva que nadie pidió) no aplica
-- acá: esto es exactamente lo contrario, una cortesía masiva que SÍ se pidió.
--
-- ============================================================
-- POR QUÉ IMPORTA QUE SEA GRATIS
-- ============================================================
--
-- Se encontró auditando en vivo que `handle_new_user()` no otorga ningún
-- módulo al nacer una cuenta, así que TODA cuenta nueva —no solo las del
-- plan gratuito— ve el panel "¿Estoy bien?" de Personal bloqueado. La
-- doctrina del producto ("EOS trabaja, el usuario observa", ver
-- `docs/personal/auditoria.md`) dice que ese panel es la puerta de entrada
-- al hábito: sin él, un usuario nuevo solo puede anotar movimientos a
-- ciegas, sin ver jamás su disponible real.
--
-- ============================================================
-- QUÉ NO CAMBIA
-- ============================================================
--
-- Solo `dashboard`. Los otros once módulos del catálogo (erp, crm, briefing,
-- documentos, lectura, alertas, decisiones, facturación, los tramos de
-- conversaciones) siguen exactamente como estaban — se contratan aparte. El
-- catálogo (`eos_modulos`) tampoco cambia de precio: se sigue vendiendo por
-- si el negocio decide cobrarlo de nuevo más adelante; lo único que cambia
-- es que hoy TODA cuenta tiene una fila de cortesía activa para él, igual
-- que ya pasa con `facturacion` desde la v74.

-- ============================================================
-- 1) De acá en más: toda cuenta nueva nace con el Panel financiero
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nombre text;
  v_whatsapp text;
begin
  v_nombre := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'nombre'), ''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    ),
    160
  );

  v_whatsapp := nullif(
    left(btrim(coalesce(new.raw_user_meta_data->>'whatsapp', '')), 40),
    ''
  );

  insert into public.usuarios (
    id,
    nombre,
    email,
    whatsapp,
    plan
  ) values (
    new.id,
    v_nombre,
    new.email,
    v_whatsapp,
    'free'
  )
  on conflict (id) do update
  set
    nombre = excluded.nombre,
    email = excluded.email,
    whatsapp = excluded.whatsapp;

  /*
   * La marca de "esta cuenta acaba de nacer", para que el callback la vea.
   *
   * `on conflict do nothing`: si por lo que sea este trigger corriera dos
   * veces para la misma cuenta —no debería, pero un insert con
   * `on conflict do update` arriba ya está escrito pensando en eso—, no se
   * pisa un onboarding que la persona ya empezó a completar.
   */
  insert into public.eos_onboarding (usuario_id, paso)
  values (new.id, 'bienvenida')
  on conflict (usuario_id) do nothing;

  /*
   * El Panel financiero de Personal, gratis desde el primer segundo (v165).
   *
   * `on conflict do nothing` por si algún día otra cosa llega a otorgarlo
   * primero (una migración de cortesía, una contratación real): nunca se
   * pisa una fila que ya diga de dónde salió el acceso.
   */
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen, notas)
  values (new.id, 'dashboard', 'activo', 'cortesia', 'Panel financiero gratis para toda cuenta desde la v165')
  on conflict (usuario_id, modulo_codigo) do nothing;

  return new;
end;
$function$;

-- ============================================================
-- 2) Hacia atrás: toda cuenta que ya existe y no lo tiene, lo recibe ahora
-- ============================================================

do $$
declare
  v_filas integer;
begin
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen, notas)
  select u.id, 'dashboard', 'activo', 'cortesia', 'Panel financiero gratis para toda cuenta desde la v165'
  from auth.users u
  where exists (select 1 from public.eos_modulos m where m.codigo = 'dashboard')
  on conflict (usuario_id, modulo_codigo) do nothing;

  get diagnostics v_filas = row_count;
  raise notice 'v165: Panel financiero otorgado a % cuenta(s) que no lo tenían.', v_filas;
end;
$$;
