begin;

create or replace function public.eos_get_or_create_action_command_v61(
  p_usuario_id uuid,
  p_request_id uuid,
  p_accion text,
  p_payload jsonb default '{}'::jsonb,
  p_conversacion_id uuid default null,
  p_mensaje_id uuid default null,
  p_origen text default 'eos-worker'
)
returns table(
  command_id uuid,
  estado text,
  idempotent boolean,
  resultado jsonb,
  payload_fingerprint text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command public.eos_action_commands%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_fingerprint text;
  v_inserted boolean := false;
begin
  if p_usuario_id is null or p_request_id is null then
    raise exception 'usuario_id y request_id son obligatorios.';
  end if;

  if nullif(btrim(p_accion), '') is null then
    raise exception 'accion es obligatoria.';
  end if;

  v_fingerprint := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.eos_action_commands (
    id,
    usuario_id,
    request_id,
    accion,
    estado,
    conversacion_id,
    mensaje_id,
    origen,
    payload,
    input_fingerprint
  ) values (
    gen_random_uuid(),
    p_usuario_id,
    p_request_id,
    btrim(p_accion),
    'recibida',
    p_conversacion_id,
    p_mensaje_id,
    left(coalesce(nullif(btrim(p_origen), ''), 'eos-worker'), 120),
    v_payload,
    v_fingerprint
  )
  on conflict (usuario_id, request_id, accion) do nothing
  returning * into v_command;

  if v_command.id is not null then
    v_inserted := true;
  else
    select * into v_command
    from public.eos_action_commands
    where usuario_id = p_usuario_id
      and request_id = p_request_id
      and accion = btrim(p_accion)
    for update;
  end if;

  if v_command.id is null then
    raise exception 'EOS_COMMAND_CREATE_FAILED';
  end if;

  if v_command.payload is distinct from v_payload
    or coalesce(v_command.input_fingerprint, '') <> v_fingerprint then
    raise exception 'EOS_COMMAND_PAYLOAD_MISMATCH';
  end if;

  if p_conversacion_id is not null
    and v_command.conversacion_id is not null
    and v_command.conversacion_id <> p_conversacion_id then
    raise exception 'EOS_COMMAND_CONTEXT_MISMATCH';
  end if;

  if p_mensaje_id is not null
    and v_command.mensaje_id is not null
    and v_command.mensaje_id <> p_mensaje_id then
    raise exception 'EOS_COMMAND_CONTEXT_MISMATCH';
  end if;

  if (p_conversacion_id is not null and v_command.conversacion_id is null)
    or (p_mensaje_id is not null and v_command.mensaje_id is null) then
    update public.eos_action_commands
    set conversacion_id = coalesce(conversacion_id, p_conversacion_id),
        mensaje_id = coalesce(mensaje_id, p_mensaje_id),
        updated_at = now()
    where id = v_command.id
    returning * into v_command;
  end if;

  return query
  select
    v_command.id,
    v_command.estado,
    not v_inserted,
    coalesce(v_command.resultado, '{}'::jsonb),
    v_fingerprint;
end;
$$;

revoke all on function public.eos_get_or_create_action_command_v61(
  uuid, uuid, text, jsonb, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.eos_get_or_create_action_command_v61(
  uuid, uuid, text, jsonb, uuid, uuid, text
) to service_role;

comment on function public.eos_get_or_create_action_command_v61(
  uuid, uuid, text, jsonb, uuid, uuid, text
) is
  'RC1 v61: crea o recupera atómicamente una orden por usuario/request/acción y rechaza replays con payload o contexto incompatibles.';

commit;
