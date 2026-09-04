-- ============================================================
-- Que el onboarding empiece a existir de verdad (v114)
-- ============================================================
--
-- QUÉ PASABA
--
-- La conversación fundacional —`/eos/onboarding`, su API, su tabla— existe
-- hace semanas y nunca se usó: `eos_onboarding` tenía cero filas de 40
-- usuarios. Nada en el alta la enlazaba; todo el mundo llegaba directo al
-- chat.
--
-- Se corrigió el lado del correo y contraseña mandando a `/eos/onboarding`
-- en vez de a `/eos/chat`. Pero con Google hay un problema distinto: el
-- botón "Continuar con Google" es el MISMO para alguien que se registra por
-- primera vez y para alguien que ya tiene cuenta y vuelve a entrar —
-- Supabase no le dice al cliente cuál de los dos es antes de terminar el
-- intercambio del código, así que el botón no puede decidir el destino.
--
-- POR QUÉ NO SE USA UNA FECHA PARA ADIVINARLO
--
-- La tentación es comparar `created_at` con `last_sign_in_at`: si son
-- iguales, es la primera vez. Se probó contra una cuenta real creada 54
-- segundos antes de esta prueba, y ya eran distintas — crear la fila e
-- iniciar la sesión no son la misma operación, así que nunca coinciden ni
-- en el caso más favorable. Cualquier margen de tiempo que se elija para
-- "son casi iguales" es arbitrario y falla distinto según la latencia del
-- momento.
--
-- LA SEÑAL QUE SÍ ES CONFIABLE
--
-- `handle_new_user()` corre exactamente una vez por cuenta, sea cual sea el
-- proveedor, porque es un `after insert on auth.users` y esa tabla sólo
-- recibe una fila por cuenta en toda su vida. Si esa misma ejecución deja
-- una fila en `eos_onboarding`, esa fila —y sólo esa— certifica "esta cuenta
-- acaba de nacer", sin adivinar nada.
--
-- El callback, después, decide mirando si existe esa fila y sigue sin
-- `completado_en`: si existe, va a onboarding sea cual sea el `next` que
-- traía. Si no existe —las 38 cuentas de antes de este cambio, o cualquiera
-- que ya lo haya terminado— sigue exactamente como hasta ahora.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_nombre text;
  v_whatsapp text;
begin
  v_nombre := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    ),
    160
  );

  v_whatsapp := nullif(
    left(btrim(coalesce(new.raw_user_meta_data ->> 'whatsapp', '')), 40),
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

  return new;
end;
$function$;
