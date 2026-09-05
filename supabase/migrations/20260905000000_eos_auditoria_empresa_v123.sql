-- v123 · La bitácora aprende de qué empresa era la acción
--
-- ============================================================
-- QUÉ FALTABA
-- ============================================================
--
-- El punto 42 de docs/lanzamiento/lista-maestra.md quedó "falta empresa,
-- que no existe hasta la fase 1" mientras usuario_id era la única frontera.
-- Ya no lo es (v109 a v119, "la empresa es la única frontera"): un usuario
-- puede ser miembro de una empresa que no es la suya propia, y una acción
-- suya sobre esa empresa hoy queda asentada con SU usuario_id, sin decir
-- sobre los libros de QUIÉN actuó. Auditar "todo lo que le pasó a la
-- empresa de Rossana" hoy exige saber de antemano cada miembro que tuvo y
-- recorrer la cadena de cada uno por separado.
--
-- ============================================================
-- POR QUÉ ESTA COLUMNA NO ENTRA EN EL HASH
-- ============================================================
--
-- `eos_auditoria_hash_v60` tiene una firma fija y explícita —numero,
-- usuario_id, evento, origen, resumen, detalle, referencia, created_at,
-- hash_previo— y agregar un parámetro ahí es un cambio de versión del
-- esquema de hash: recalcularía la cadena entera o dejaría dos versiones
-- de la verificación conviviendo. Ninguna de las dos vale la pena para un
-- dato que no es parte de la promesa de esta tabla.
--
-- Esa promesa —"esto es lo que pasó, y nadie lo pudo reescribir después"—
-- sigue intacta con o sin `empresa_id`: la cadena verifica al usuario y su
-- secuencia de eventos exactamente igual. `empresa_id` es metadata de
-- consulta, agregada aparte, nunca parte del eslabón.
--
-- Columna nueva, nullable: las filas existentes se quedan en null —no hay
-- forma honesta de reconstruir retroactivamente en qué empresa estaba
-- actuando cada usuario en cada fila vieja— y eso no rompe nada porque la
-- columna nunca fue parte del hash que las selló.

alter table public.eos_auditoria_v60
  add column if not exists empresa_id uuid references public.eos_empresas(id);

comment on column public.eos_auditoria_v60.empresa_id is
  'Metadata de consulta, fuera de la cadena de hash a propósito (ver v123). Null en filas de antes del 5 de septiembre de 2026, o en eventos que no son del ERP.';

create index if not exists eos_auditoria_empresa_idx
  on public.eos_auditoria_v60 (empresa_id, numero desc)
  where empresa_id is not null;
