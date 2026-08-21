-- Recuperada desde supabase_migrations.schema_migrations el 2026-08-21.
--
-- Esta migración se aplicó al remoto sin dejar archivo en el repo (venían
-- de la rama RC1 y del dashboard). El SQL de acá es exactamente el que se
-- ejecutó, leído de la columna `statements`. Se restituye para que el
-- repositorio pueda reconstruir el esquema desde cero.

begin;

create index if not exists objetivos_usuario_id_idx
  on public.objetivos (usuario_id);

comment on index public.objetivos_usuario_id_idx is
  'Índice de cobertura para objetivos.usuario_id; acelera joins/filtros por usuario y operaciones referenciales sin cambiar RLS ni semántica funcional.';

commit;
