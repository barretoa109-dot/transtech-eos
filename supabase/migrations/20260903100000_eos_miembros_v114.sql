-- Miembros: invitar, aceptar, cambiar de rol y sacar (v114).
--
-- ============================================================
-- LA FRONTERA EXISTÍA Y NO SE USABA
-- ============================================================
--
-- Las v109 a v113 dejaron la empresa atravesando policies, funciones y rutas.
-- Pero cada empresa tiene exactamente un miembro y nadie puede invitar a
-- nadie: la frontera está probada y no sirve para nada todavía.
--
-- ============================================================
-- EL PROBLEMA QUE HAY QUE RESOLVER ANTES DE INVITAR
-- ============================================================
--
-- Todo usuario tiene su propia empresa desde la v109, creada por trigger. Si
-- se lo invita a otra, `eos_empresa_de_v109` le seguiría devolviendo la suya
-- —ordena por `rol = 'propietario'`— y no vería nada de la empresa a la que
-- lo invitaron.
--
-- Entonces hace falta una EMPRESA ACTIVA: en cuál está trabajando ahora. Un
-- índice único parcial garantiza que sea exactamente una.
--
-- ============================================================
-- INVITAR NO ES AGREGAR
-- ============================================================
--
-- Una invitación queda PENDIENTE hasta que la persona la acepta. Agregar a
-- alguien a una empresa sin que se entere le da acceso a datos de un negocio
-- ajeno y, peor, le cambia lo que ve al entrar. Que tenga que aceptar es la
-- diferencia entre invitar y meter.
--
-- La invitación se ata al CORREO, no a un token en un enlace: no hay que
-- mandar mail para que funcione, no hay token que se filtre por WhatsApp, y
-- si la persona todavía no tiene cuenta la invitación la espera.

-- ============================================================
-- 1. La empresa activa
-- ============================================================

alter table public.eos_empresa_miembros
  add column if not exists activa boolean not null default false;

comment on column public.eos_empresa_miembros.activa is
  'v114: en qué empresa está trabajando el usuario ahora. Exactamente una por usuario.';

-- La empresa propia arranca como la activa: es la que venían usando.
update public.eos_empresa_miembros
set activa = true
where rol = 'propietario'
  and not exists (
    select 1 from public.eos_empresa_miembros otra
    where otra.usuario_id = eos_empresa_miembros.usuario_id and otra.activa
  );

create unique index if not exists eos_empresa_miembros_activa
  on public.eos_empresa_miembros (usuario_id)
  where activa;

-- La resolución pasa a honrar la activa. Se conserva el desempate por
-- propietario para cualquier fila que, por lo que sea, no tenga ninguna
-- marcada: sin eso, un usuario en ese estado se quedaría sin empresa y sin
-- acceso a sus propios datos.
create or replace function public.eos_empresa_de_v109(p_usuario_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.empresa_id
  from public.eos_empresa_miembros m
  where m.usuario_id = p_usuario_id
  order by m.activa desc, (m.rol = 'propietario') desc, m.creado_en
  limit 1;
$$;

-- ============================================================
-- 2. Las invitaciones
-- ============================================================

create table if not exists public.eos_empresa_invitaciones_v114 (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.eos_empresas(id) on delete cascade,

  -- Siempre en minúsculas y sin espacios: "Ana@X.com " y "ana@x.com" son la
  -- misma persona, y si no se normaliza acá la invitación nunca se encuentra.
  email text not null check (length(btrim(email)) between 3 and 320),

  rol text not null check (rol in (
    'administrador', 'ventas', 'compras', 'deposito', 'caja', 'contabilidad', 'solo_lectura'
  )),

  invitado_por uuid not null references auth.users(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'cancelada')),

  creado_en timestamptz not null default now(),
  resuelto_en timestamptz
);

comment on table public.eos_empresa_invitaciones_v114 is
  'v114: invitaciones a una empresa, atadas al correo. Pendientes hasta que la persona acepte.';

-- No se puede invitar dos veces al mismo correo a la misma empresa mientras
-- la primera siga pendiente. Sin esto, cinco clics dejan cinco invitaciones y
-- la persona ve cinco veces lo mismo.
create unique index if not exists eos_empresa_invitaciones_pendiente
  on public.eos_empresa_invitaciones_v114 (empresa_id, email)
  where estado = 'pendiente';

create index if not exists eos_empresa_invitaciones_email_idx
  on public.eos_empresa_invitaciones_v114 (email) where estado = 'pendiente';

-- No se invita al rol `propietario`: hay uno solo y es quien creó la empresa.
-- Traspasarla es otra operación, con otras consecuencias, y no se hace por
-- accidente desde el formulario de invitar.

alter table public.eos_empresa_invitaciones_v114 enable row level security;

drop policy if exists eos_empresa_invitaciones_select on public.eos_empresa_invitaciones_v114;
create policy eos_empresa_invitaciones_select
  on public.eos_empresa_invitaciones_v114
  for select to authenticated
  using (
    -- La ve quien pertenece a la empresa...
    exists (
      select 1 from public.eos_empresa_miembros m
      where m.empresa_id = eos_empresa_invitaciones_v114.empresa_id
        and m.usuario_id = (select auth.uid())
    )
    -- ...o la persona invitada, que necesita poder verla para aceptarla.
    or lower(email) = lower((select u.email from auth.users u where u.id = (select auth.uid())))
  );

revoke all on table public.eos_empresa_invitaciones_v114 from public, anon, authenticated;
grant select on table public.eos_empresa_invitaciones_v114 to authenticated;
grant all on table public.eos_empresa_invitaciones_v114 to service_role;

-- ============================================================
-- 3. Quién puede administrar
-- ============================================================

create or replace function public.eos_empresa_administra_v114(p_usuario_id uuid, p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.eos_empresa_miembros m
    where m.empresa_id = p_empresa_id
      and m.usuario_id = p_usuario_id
      and m.rol in ('propietario', 'administrador')
  );
$$;

revoke all on function public.eos_empresa_administra_v114(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_administra_v114(uuid, uuid) to service_role;

-- ============================================================
-- 4. Invitar
-- ============================================================

create or replace function public.eos_empresa_invitar_v114(
  p_actor uuid,
  p_empresa_id uuid,
  p_email text,
  p_rol text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_id uuid;
  v_ya_miembro boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not public.eos_empresa_administra_v114(p_actor, p_empresa_id) then
    raise exception 'EOS_EMPRESA_SIN_PERMISO';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if position('@' in v_email) = 0 then
    raise exception 'EOS_EMAIL_INVALIDO';
  end if;

  -- Invitarse a uno mismo no hace nada y confunde: se corta con un mensaje.
  if v_email = lower((select u.email from auth.users u where u.id = p_actor)) then
    raise exception 'EOS_INVITACION_A_SI_MISMO';
  end if;

  select exists (
    select 1
    from public.eos_empresa_miembros m
    join auth.users u on u.id = m.usuario_id
    where m.empresa_id = p_empresa_id and lower(u.email) = v_email
  ) into v_ya_miembro;

  if v_ya_miembro then
    raise exception 'EOS_YA_ES_MIEMBRO';
  end if;

  insert into public.eos_empresa_invitaciones_v114 (empresa_id, email, rol, invitado_por)
  values (p_empresa_id, v_email, p_rol, p_actor)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'invitacion_id', v_id, 'email', v_email);
end;
$$;

revoke all on function public.eos_empresa_invitar_v114(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.eos_empresa_invitar_v114(uuid, uuid, text, text) to service_role;

-- ============================================================
-- 5. Aceptar
-- ============================================================
--
-- Solo la puede aceptar quien tiene ESE correo. Es lo que hace que invitar no
-- sea lo mismo que agregar.

create or replace function public.eos_empresa_aceptar_v114(p_usuario_id uuid, p_invitacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.eos_empresa_invitaciones_v114%rowtype;
  v_email text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_inv
  from public.eos_empresa_invitaciones_v114
  where id = p_invitacion_id
  for update;

  if not found or v_inv.estado <> 'pendiente' then
    raise exception 'EOS_INVITACION_NO_VIGENTE';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_usuario_id;

  if v_email is distinct from lower(v_inv.email) then
    raise exception 'EOS_INVITACION_DE_OTRO';
  end if;

  insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol)
  values (v_inv.empresa_id, p_usuario_id, v_inv.rol)
  on conflict (empresa_id, usuario_id) do update set rol = excluded.rol;

  update public.eos_empresa_invitaciones_v114
  set estado = 'aceptada', resuelto_en = now()
  where id = p_invitacion_id;

  -- NO se cambia la empresa activa. Aceptar es entrar; en cuál trabaja lo
  -- elige la persona. Cambiársela sin avisar haría que al entrar viera datos
  -- de otro negocio sin entender por qué.
  return jsonb_build_object('ok', true, 'empresa_id', v_inv.empresa_id, 'rol', v_inv.rol);
end;
$$;

revoke all on function public.eos_empresa_aceptar_v114(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_aceptar_v114(uuid, uuid) to service_role;

-- ============================================================
-- 6. Cambiar de empresa activa
-- ============================================================

create or replace function public.eos_empresa_activar_v114(p_usuario_id uuid, p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not exists (
    select 1 from public.eos_empresa_miembros
    where usuario_id = p_usuario_id and empresa_id = p_empresa_id
  ) then
    raise exception 'EOS_NO_ES_MIEMBRO';
  end if;

  -- Primero se apagan todas y después se prende una: al revés, el índice
  -- único de "una activa por usuario" rechazaría el update intermedio.
  update public.eos_empresa_miembros set activa = false
  where usuario_id = p_usuario_id and activa;

  update public.eos_empresa_miembros set activa = true
  where usuario_id = p_usuario_id and empresa_id = p_empresa_id;

  return jsonb_build_object('ok', true, 'empresa_id', p_empresa_id);
end;
$$;

revoke all on function public.eos_empresa_activar_v114(uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_activar_v114(uuid, uuid) to service_role;

-- ============================================================
-- 7. Sacar a alguien, y cambiarle el rol
-- ============================================================
--
-- Sacar a un miembro NO borra sus datos: las filas que cargó siguen con su
-- `usuario_id` y con la `empresa_id` del negocio. Es lo correcto —el trabajo
-- fue hecho y la empresa lo necesita— y hay que decirlo, porque la intuición
-- dice lo contrario.

create or replace function public.eos_empresa_quitar_v114(
  p_actor uuid,
  p_empresa_id uuid,
  p_usuario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not public.eos_empresa_administra_v114(p_actor, p_empresa_id) then
    raise exception 'EOS_EMPRESA_SIN_PERMISO';
  end if;

  select rol into v_rol
  from public.eos_empresa_miembros
  where empresa_id = p_empresa_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_NO_ES_MIEMBRO';
  end if;

  -- Al propietario no se lo saca: la empresa quedaría sin dueño y nadie
  -- podría volver a administrarla.
  if v_rol = 'propietario' then
    raise exception 'EOS_NO_SE_SACA_AL_PROPIETARIO';
  end if;

  delete from public.eos_empresa_miembros
  where empresa_id = p_empresa_id and usuario_id = p_usuario_id;

  return jsonb_build_object('ok', true, 'usuario_id', p_usuario_id);
end;
$$;

revoke all on function public.eos_empresa_quitar_v114(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.eos_empresa_quitar_v114(uuid, uuid, uuid) to service_role;

create or replace function public.eos_empresa_cambiar_rol_v114(
  p_actor uuid,
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_rol text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if not public.eos_empresa_administra_v114(p_actor, p_empresa_id) then
    raise exception 'EOS_EMPRESA_SIN_PERMISO';
  end if;

  if p_rol = 'propietario' then
    raise exception 'EOS_PROPIETARIO_NO_SE_ASIGNA';
  end if;

  select rol into v_actual
  from public.eos_empresa_miembros
  where empresa_id = p_empresa_id and usuario_id = p_usuario_id;

  if not found then
    raise exception 'EOS_NO_ES_MIEMBRO';
  end if;

  if v_actual = 'propietario' then
    raise exception 'EOS_PROPIETARIO_NO_CAMBIA_DE_ROL';
  end if;

  update public.eos_empresa_miembros
  set rol = p_rol
  where empresa_id = p_empresa_id and usuario_id = p_usuario_id;

  return jsonb_build_object('ok', true, 'usuario_id', p_usuario_id, 'rol', p_rol);
end;
$$;

revoke all on function public.eos_empresa_cambiar_rol_v114(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.eos_empresa_cambiar_rol_v114(uuid, uuid, uuid, text) to service_role;
