-- Que un catastro abandonado deje de ocupar un lugar de tarjeta (v77).
--
-- Bancard permite cinco tarjetas catastradas por usuario, y
-- `eos_bancard_preparar_catastro_v51` contaba dentro de ese cupo las filas en
-- 'pendiente'. Una fila queda 'pendiente' apenas se abre el formulario de
-- catastro, ANTES de que la persona escriba nada: si cierra la pestaña, si
-- Bancard no alcanza a avisar el resultado, o si registra una tarjeta que la
-- pasarela ya tenía y por lo tanto no duplica, esa fila no se resuelve nunca.
--
-- Resultado: cada intento fallido quemaba un lugar para siempre. A la quinta
-- vez, alguien con UNA tarjeta real recibía "llegaste al máximo de 5 tarjetas
-- guardadas" y no podía pagar. El usuario de la certificación de Bancard ya
-- tenía dos de sus cinco lugares quemados así el 27/8/2026.
--
-- Se agrega el estado 'caducada' y el cupo pasa a contar sólo lo que de verdad
-- ocupa lugar en Bancard: las activas, más los catastros de la última media
-- hora, que son los que todavía pueden completarse.

alter table public.eos_bancard_tarjetas_v51
  drop constraint if exists eos_bancard_tarjetas_v51_estado_check;

alter table public.eos_bancard_tarjetas_v51
  add constraint eos_bancard_tarjetas_v51_estado_check
  check (estado in ('pendiente', 'activa', 'eliminada', 'fallida', 'caducada'));

-- Los abandonados que ya estaban en la base dejan de ocupar lugar.
update public.eos_bancard_tarjetas_v51
   set estado = 'caducada',
       updated_at = now()
 where estado = 'pendiente'
   and created_at < now() - interval '30 minutes';

create or replace function public.eos_bancard_preparar_catastro_v51(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bancard_user_id bigint;
  v_card_id bigint;
  v_ocupados int;
  v_tarjeta_id uuid;
begin
  if p_usuario_id is null then
    raise exception 'EOS_BANCARD_USER_REQUIRED';
  end if;

  perform 1 from public.usuarios u where u.id = p_usuario_id for update;

  if not found then
    raise exception 'EOS_BANCARD_USER_NOT_FOUND';
  end if;

  insert into public.eos_bancard_usuarios_v51 (usuario_id)
  values (p_usuario_id)
  on conflict (usuario_id) do nothing;

  select b.bancard_user_id
    into v_bancard_user_id
  from public.eos_bancard_usuarios_v51 b
  where b.usuario_id = p_usuario_id;

  -- Los catastros viejos sin resolver se dan por abandonados acá también, y no
  -- sólo al reconciliar: así el cupo se libera aunque nadie pase por la
  -- pantalla de pago entre un intento y el siguiente.
  update public.eos_bancard_tarjetas_v51 t
     set estado = 'caducada',
         updated_at = now()
   where t.usuario_id = p_usuario_id
     and t.estado = 'pendiente'
     and t.created_at < now() - interval '30 minutes';

  -- Bancard permite hasta 5 tarjetas catastradas por usuario. Ocupan lugar las
  -- que existen allá y los intentos que todavía pueden completarse.
  select count(*)
    into v_ocupados
  from public.eos_bancard_tarjetas_v51 t
  where t.usuario_id = p_usuario_id
    and t.estado in ('activa', 'pendiente');

  if v_ocupados >= 5 then
    raise exception 'EOS_BANCARD_CARD_LIMIT';
  end if;

  -- card_id monotónico por usuario: no se reutiliza tras eliminar.
  select coalesce(max(t.bancard_card_id), 0) + 1
    into v_card_id
  from public.eos_bancard_tarjetas_v51 t
  where t.usuario_id = p_usuario_id;

  insert into public.eos_bancard_tarjetas_v51 (
    usuario_id,
    bancard_card_id,
    estado
  ) values (
    p_usuario_id,
    v_card_id,
    'pendiente'
  )
  returning id into v_tarjeta_id;

  return jsonb_build_object(
    'ok', true,
    'tarjeta_id', v_tarjeta_id,
    'bancard_user_id', v_bancard_user_id,
    'bancard_card_id', v_card_id
  );
end;
$function$;
