-- Reglas de categoría por persona (v234).
--
-- Cuando alguien corrige la categoría de un gasto, EOS guarda la corrección
-- como regla: "este comercio/concepto es de esta categoría". Las próximas
-- veces que aparece, se clasifica igual sin volver a preguntar.
--
-- `patron` es el núcleo normalizado de la descripción (sin números, sin
-- tildes, en minúsculas), el mismo que usa `normalizarDescripcion` para
-- agrupar series. `categoria` es lo que escribió la persona, con sus tildes.
--
-- Las reglas se aplican al LEER, no reescriben filas: corregir una regla
-- cambia todos los movimientos parecidos sin tocar los datos guardados.
--
-- Sin begin/commit de nivel superior: `db push` ya envuelve la migración.
-- Idempotente: se puede correr dos veces sin efecto.

create table if not exists public.eos_reglas_categoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  patron text not null check (char_length(patron) between 2 and 120),
  categoria text not null check (char_length(categoria) between 1 and 40),
  veces integer not null default 1 check (veces >= 0),
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  unique (usuario_id, patron)
);

create index if not exists eos_reglas_categoria_usuario_idx
  on public.eos_reglas_categoria (usuario_id);

alter table public.eos_reglas_categoria enable row level security;

drop policy if exists reglas_categoria_select on public.eos_reglas_categoria;
create policy reglas_categoria_select on public.eos_reglas_categoria
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists reglas_categoria_insert on public.eos_reglas_categoria;
create policy reglas_categoria_insert on public.eos_reglas_categoria
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy if exists reglas_categoria_update on public.eos_reglas_categoria;
create policy reglas_categoria_update on public.eos_reglas_categoria
  for update to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists reglas_categoria_delete on public.eos_reglas_categoria;
create policy reglas_categoria_delete on public.eos_reglas_categoria
  for delete to authenticated using ((select auth.uid()) = usuario_id);

-- Datos de una persona: anon no ve nada (ver eos_seguridad_anon).
revoke all on public.eos_reglas_categoria from anon;
grant select, insert, update, delete on public.eos_reglas_categoria to authenticated;
