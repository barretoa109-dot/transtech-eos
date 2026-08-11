begin;

-- Conversaciones: cada usuario solo puede acceder a las suyas.
alter table public.conversaciones
  alter column usuario_id set not null;

alter table public.conversaciones enable row level security;

drop policy if exists conversaciones_select_propias on public.conversaciones;
drop policy if exists conversaciones_insert_propias on public.conversaciones;
drop policy if exists conversaciones_update_propias on public.conversaciones;
drop policy if exists conversaciones_delete_propias on public.conversaciones;

create policy conversaciones_select_propias
on public.conversaciones
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy conversaciones_insert_propias
on public.conversaciones
for insert
to authenticated
with check ((select auth.uid()) = usuario_id);

create policy conversaciones_update_propias
on public.conversaciones
for update
to authenticated
using ((select auth.uid()) = usuario_id)
with check ((select auth.uid()) = usuario_id);

create policy conversaciones_delete_propias
on public.conversaciones
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

create index if not exists conversaciones_usuario_created_idx
  on public.conversaciones (usuario_id, created_at desc);

revoke all on table public.conversaciones from anon;
grant select, insert, update, delete on table public.conversaciones to authenticated;
grant all on table public.conversaciones to service_role;

-- Mensajes: una sola fila por turno/rol, incluso si n8n reintenta.
alter table public.mensajes
  add column if not exists request_id uuid,
  add column if not exists origen text not null default 'eos-web',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.mensajes as m
set usuario_id = c.usuario_id
from public.conversaciones as c
where m.usuario_id is null
  and m.conversacion_id = c.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mensajes_conversacion_id_fkey'
      and conrelid = 'public.mensajes'::regclass
  ) then
    alter table public.mensajes
      add constraint mensajes_conversacion_id_fkey
      foreign key (conversacion_id)
      references public.conversaciones(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mensajes_usuario_id_fkey'
      and conrelid = 'public.mensajes'::regclass
  ) then
    alter table public.mensajes
      add constraint mensajes_usuario_id_fkey
      foreign key (usuario_id)
      references public.usuarios(id)
      on delete cascade
      not valid;
  end if;
end
$$;

alter table public.mensajes
  validate constraint mensajes_conversacion_id_fkey;

alter table public.mensajes
  validate constraint mensajes_usuario_id_fkey;

create unique index if not exists mensajes_request_role_unique_idx
  on public.mensajes (usuario_id, request_id, rol)
  where request_id is not null;

create index if not exists mensajes_conversacion_created_idx
  on public.mensajes (conversacion_id, created_at);

create index if not exists mensajes_usuario_created_idx
  on public.mensajes (usuario_id, created_at desc)
  where usuario_id is not null;

create or replace function public.eos_merge_duplicate_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if new.request_id is null or new.usuario_id is null then
    return new;
  end if;

  select m.id
  into existing_id
  from public.mensajes as m
  where m.usuario_id = new.usuario_id
    and m.request_id = new.request_id
    and m.rol = new.rol
  limit 1
  for update;

  if existing_id is null then
    return new;
  end if;

  if new.rol = 'eos' then
    update public.mensajes
    set texto = new.texto,
        origen = coalesce(nullif(new.origen, ''), origen),
        metadata = metadata || coalesce(new.metadata, '{}'::jsonb),
        created_at = coalesce(new.created_at, now())
    where id = existing_id;
  else
    update public.mensajes
    set metadata = metadata || coalesce(new.metadata, '{}'::jsonb)
    where id = existing_id;
  end if;

  return null;
end;
$$;

drop trigger if exists eos_merge_duplicate_message_before_insert
on public.mensajes;

create trigger eos_merge_duplicate_message_before_insert
before insert on public.mensajes
for each row
execute function public.eos_merge_duplicate_message();

revoke all on function public.eos_merge_duplicate_message() from public;
grant execute on function public.eos_merge_duplicate_message() to service_role;

revoke all on table public.mensajes from anon;
grant select, insert, delete on table public.mensajes to authenticated;
grant all on table public.mensajes to service_role;

-- Memoria canónica: conserva compatibilidad con eos_memory y agrega trazabilidad.
alter table public.eos_memory
  add column if not exists clave text,
  add column if not exists entidad text,
  add column if not exists valor jsonb not null default '{}'::jsonb,
  add column if not exists confianza numeric(4, 3) not null default 0.800,
  add column if not exists confirmada boolean not null default false,
  add column if not exists conversacion_id uuid,
  add column if not exists mensaje_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists ultima_observacion_at timestamptz not null default now(),
  add column if not exists observaciones integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_usuario_id_fkey'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_usuario_id_fkey
      foreign key (usuario_id)
      references public.usuarios(id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_conversacion_id_fkey'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_conversacion_id_fkey
      foreign key (conversacion_id)
      references public.conversaciones(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_mensaje_id_fkey'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_mensaje_id_fkey
      foreign key (mensaje_id)
      references public.mensajes(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_confianza_check'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_confianza_check
      check (confianza >= 0 and confianza <= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'eos_memory_observaciones_check'
      and conrelid = 'public.eos_memory'::regclass
  ) then
    alter table public.eos_memory
      add constraint eos_memory_observaciones_check
      check (observaciones >= 1);
  end if;
end
$$;

alter table public.eos_memory
  validate constraint eos_memory_usuario_id_fkey;

alter table public.eos_memory
  validate constraint eos_memory_conversacion_id_fkey;

alter table public.eos_memory
  validate constraint eos_memory_mensaje_id_fkey;

create unique index if not exists eos_memory_usuario_clave_unique_idx
  on public.eos_memory (usuario_id, clave)
  where clave is not null;

create index if not exists eos_memory_contexto_idx
  on public.eos_memory (
    usuario_id,
    estado,
    importancia desc,
    updated_at desc
  );

create or replace function public.eos_merge_business_memory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  new.clave := nullif(
    trim(both '.' from regexp_replace(lower(trim(new.clave)), '[^a-z0-9._-]+', '_', 'g')),
    ''
  );

  if new.clave is null then
    return new;
  end if;

  select m.id
  into existing_id
  from public.eos_memory as m
  where m.usuario_id = new.usuario_id
    and m.clave = new.clave
  limit 1
  for update;

  if existing_id is null then
    return new;
  end if;

  update public.eos_memory
  set categoria = coalesce(nullif(new.categoria, ''), categoria),
      titulo = coalesce(nullif(new.titulo, ''), titulo),
      contenido = coalesce(nullif(new.contenido, ''), contenido),
      entidad = coalesce(nullif(new.entidad, ''), entidad),
      valor = case
        when new.valor = '{}'::jsonb then valor
        else new.valor
      end,
      importancia = greatest(coalesce(importancia, 1), coalesce(new.importancia, 1)),
      confianza = greatest(coalesce(confianza, 0), coalesce(new.confianza, 0)),
      confirmada = confirmada or coalesce(new.confirmada, false),
      origen = coalesce(nullif(new.origen, ''), origen),
      estado = coalesce(nullif(new.estado, ''), estado),
      conversacion_id = coalesce(new.conversacion_id, conversacion_id),
      mensaje_id = coalesce(new.mensaje_id, mensaje_id),
      metadata = metadata || coalesce(new.metadata, '{}'::jsonb),
      ultima_observacion_at = now(),
      observaciones = coalesce(observaciones, 1) + 1,
      updated_at = now()
  where id = existing_id;

  return null;
end;
$$;

drop trigger if exists eos_merge_business_memory_before_insert
on public.eos_memory;

create trigger eos_merge_business_memory_before_insert
before insert on public.eos_memory
for each row
execute function public.eos_merge_business_memory();

revoke all on function public.eos_merge_business_memory() from public;
grant execute on function public.eos_merge_business_memory() to service_role;

create table if not exists public.eos_memory_evidence (
  id uuid primary key default gen_random_uuid(),
  memoria_id uuid not null
    references public.eos_memory(id) on delete cascade,
  usuario_id uuid not null
    references public.usuarios(id) on delete cascade,
  conversacion_id uuid
    references public.conversaciones(id) on delete set null,
  mensaje_id uuid
    references public.mensajes(id) on delete set null,
  contenido text not null,
  evidencia_hash text not null,
  origen text not null default 'chat',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (memoria_id, evidencia_hash)
);

create index if not exists eos_memory_evidence_usuario_created_idx
  on public.eos_memory_evidence (usuario_id, created_at desc);

alter table public.eos_memory_evidence enable row level security;

drop policy if exists eos_memory_evidence_select_propias
on public.eos_memory_evidence;

drop policy if exists eos_memory_evidence_delete_propias
on public.eos_memory_evidence;

create policy eos_memory_evidence_select_propias
on public.eos_memory_evidence
for select
to authenticated
using ((select auth.uid()) = usuario_id);

create policy eos_memory_evidence_delete_propias
on public.eos_memory_evidence
for delete
to authenticated
using ((select auth.uid()) = usuario_id);

create or replace function public.eos_capture_memory_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  evidence_hash text;
begin
  if new.contenido is null or trim(new.contenido) = '' then
    return new;
  end if;

  evidence_hash := md5(
    new.usuario_id::text || '|' ||
    coalesce(new.clave, '') || '|' ||
    new.contenido || '|' ||
    coalesce(new.mensaje_id::text, new.conversacion_id::text, '')
  );

  insert into public.eos_memory_evidence (
    memoria_id,
    usuario_id,
    conversacion_id,
    mensaje_id,
    contenido,
    evidencia_hash,
    origen,
    metadata
  ) values (
    new.id,
    new.usuario_id,
    new.conversacion_id,
    new.mensaje_id,
    new.contenido,
    evidence_hash,
    coalesce(nullif(new.origen, ''), 'chat'),
    coalesce(new.metadata, '{}'::jsonb)
  )
  on conflict (memoria_id, evidencia_hash) do nothing;

  return new;
end;
$$;

drop trigger if exists eos_capture_memory_evidence_after_write
on public.eos_memory;

create trigger eos_capture_memory_evidence_after_write
after insert or update on public.eos_memory
for each row
execute function public.eos_capture_memory_evidence();

revoke all on function public.eos_capture_memory_evidence() from public;
grant execute on function public.eos_capture_memory_evidence() to service_role;

revoke all on table public.eos_memory from anon;
grant select, insert, update, delete on table public.eos_memory to authenticated;
grant all on table public.eos_memory to service_role;

revoke all on table public.eos_memory_evidence from anon;
grant select, delete on table public.eos_memory_evidence to authenticated;
grant all on table public.eos_memory_evidence to service_role;

-- Cierra una política histórica que permitía acceso global al contexto.
drop policy if exists "allow all eos_contexto" on public.eos_contexto;

create policy eos_contexto_select_propio
on public.eos_contexto
for select
to authenticated
using ((select auth.uid())::text = user_id);

create policy eos_contexto_insert_propio
on public.eos_contexto
for insert
to authenticated
with check ((select auth.uid())::text = user_id);

create policy eos_contexto_update_propio
on public.eos_contexto
for update
to authenticated
using ((select auth.uid())::text = user_id)
with check ((select auth.uid())::text = user_id);

create policy eos_contexto_delete_propio
on public.eos_contexto
for delete
to authenticated
using ((select auth.uid())::text = user_id);

create index if not exists eos_contexto_user_updated_idx
  on public.eos_contexto (user_id, updated_at desc);

revoke all on table public.eos_contexto from anon;
grant select, insert, update, delete on table public.eos_contexto to authenticated;
grant all on table public.eos_contexto to service_role;

commit;
