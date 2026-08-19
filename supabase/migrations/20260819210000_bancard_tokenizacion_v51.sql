-- Bancard vPOS 2.0: catastro de tarjetas y cobro recurrente (v51).
--
-- Bancard identifica usuarios y tarjetas con ENTEROS (Entero 19), pero
-- en EOS los usuarios son UUID. Esta migración crea el mapeo estable
-- uuid -> bigint, más el registro de tarjetas catastradas.
--
-- Nunca se guarda el número de tarjeta: Bancard sólo nos devuelve un
-- número enmascarado y un alias_token de vida corta (minutos), que se
-- pide fresco en cada cobro vía users_cards.

create table if not exists public.eos_bancard_usuarios_v51 (
  usuario_id uuid primary key
    references public.usuarios (id) on delete cascade,
  bancard_user_id bigint generated always as identity unique,
  created_at timestamptz not null default now()
);

create table if not exists public.eos_bancard_tarjetas_v51 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null
    references public.usuarios (id) on delete cascade,
  bancard_card_id bigint not null,
  catastro_process_id text,
  card_masked_number text,
  card_brand text,
  card_type text,
  expiration_date text,
  bancard_processed boolean,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'activa', 'eliminada', 'fallida')),
  es_principal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, bancard_card_id)
);

create index if not exists eos_bancard_tarjetas_v51_usuario_idx
  on public.eos_bancard_tarjetas_v51 (usuario_id, estado);

-- Una sola tarjeta principal por usuario (la que se usa para renovar).
create unique index if not exists eos_bancard_tarjetas_v51_principal_idx
  on public.eos_bancard_tarjetas_v51 (usuario_id)
  where es_principal and estado = 'activa';

-- shop_process_id debe ser un entero único de hasta 15 dígitos.
create sequence if not exists public.eos_bancard_shop_process_id_seq
  as bigint
  start with 1000001
  maxvalue 999999999999999
  no cycle;

alter table public.eos_bancard_usuarios_v51 enable row level security;
alter table public.eos_bancard_tarjetas_v51 enable row level security;

-- El usuario sólo puede LEER sus propias tarjetas. Toda escritura pasa
-- por el service role, porque el estado real lo define Bancard.
drop policy if exists eos_bancard_tarjetas_v51_select_own
  on public.eos_bancard_tarjetas_v51;

create policy eos_bancard_tarjetas_v51_select_own
  on public.eos_bancard_tarjetas_v51
  for select
  to authenticated
  using (usuario_id = auth.uid());

revoke all on public.eos_bancard_usuarios_v51 from anon, authenticated;
revoke all on public.eos_bancard_tarjetas_v51 from anon, authenticated;
grant select on public.eos_bancard_tarjetas_v51 to authenticated;

-- Permitir 'bancard' como proveedor de pago. El nombre del check
-- existente no está garantizado, así que se localiza dinámicamente.
do $$
declare
  v_constraint text;
begin
  select con.conname
    into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'solicitudes_pago'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%proveedor%'
  limit 1;

  if v_constraint is not null then
    execute format(
      'alter table public.solicitudes_pago drop constraint %I',
      v_constraint
    );
  end if;
end $$;

alter table public.solicitudes_pago
  add constraint solicitudes_pago_proveedor_check
  check (proveedor in ('pagopar', 'transferencia', 'bancard'));

/*
 * Prepara un catastro de tarjeta de forma atómica:
 * asegura el bancard_user_id del usuario, reserva el siguiente
 * card_id libre y crea la fila 'pendiente' que el callback confirmará.
 */
create or replace function public.eos_bancard_preparar_catastro_v51(
  p_usuario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bancard_user_id bigint;
  v_card_id bigint;
  v_activas int;
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

  -- Bancard permite hasta 5 tarjetas catastradas por usuario.
  select count(*)
    into v_activas
  from public.eos_bancard_tarjetas_v51 t
  where t.usuario_id = p_usuario_id
    and t.estado in ('activa', 'pendiente');

  if v_activas >= 5 then
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
$$;

revoke all on function public.eos_bancard_preparar_catastro_v51(uuid)
  from public, anon, authenticated;
grant execute on function public.eos_bancard_preparar_catastro_v51(uuid)
  to service_role;

comment on function public.eos_bancard_preparar_catastro_v51(uuid) is
  'Bancard v51: reserva atómicamente bancard_user_id y card_id para iniciar un catastro, aplicando el límite de 5 tarjetas por usuario.';
