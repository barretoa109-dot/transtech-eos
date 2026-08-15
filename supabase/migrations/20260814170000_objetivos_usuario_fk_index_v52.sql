begin;

create index if not exists objetivos_usuario_id_idx
  on public.objetivos (usuario_id);

comment on index public.objetivos_usuario_id_idx is
  'Índice de cobertura para objetivos.usuario_id; acelera joins/filtros por usuario y operaciones referenciales sin cambiar RLS ni semántica funcional.';

commit;
