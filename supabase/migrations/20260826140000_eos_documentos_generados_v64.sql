-- EOS — Documentos generados a pedido
--
-- ============================================================
-- POR QUÉ SE GUARDA LA DESCRIPCIÓN Y NO EL ARCHIVO
-- ============================================================
--
-- Cuando EOS arma un cuadro de necesidades o un presupuesto, lo que produce no
-- es un .xlsx: es la DESCRIPCIÓN del documento (ver `lib/documentos/
-- especificacion.ts`). El archivo se dibuja a partir de ella en el momento en
-- que alguien lo baja.
--
-- Guardar la descripción y no el binario tiene tres consecuencias buenas:
--
--   1. El mismo documento se baja en Excel, en PDF o en Word sin que EOS lo
--      tenga que rehacer, y sin triplicar el almacenamiento.
--   2. No hace falta un bucket, ni URLs firmadas, ni una tarea que limpie
--      archivos huérfanos. Un JSON en una fila no se cae del storage.
--   3. Si mañana mejora el renderizador —un corte de página, una columna mejor
--      alineada—, los documentos VIEJOS salen mejorados también.
--
-- El costo es que dibujar tarda unos milisegundos en cada descarga. Para un
-- cuadro de dos mil filas eso es despreciable al lado de la transferencia.
--
-- ============================================================
-- POR QUÉ ESTO NO ES `documentos`
-- ============================================================
--
-- `documents` es lo que el usuario SUBE para que EOS lo lea. Esto es lo que
-- EOS ESCRIBE para que el usuario lo baje. Comparten la palabra y nada más:
-- distinto dueño del contenido, distinto ciclo de vida y, sobre todo, distinta
-- confianza — lo de acá lo redactó un modelo y por eso pasa por un
-- normalizador antes de llegar a la base.

create table if not exists public.eos_documentos_generados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- De qué conversación salió, cuando salió de una. Sin FK dura: un documento
  -- pedido desde el panel no viene de ninguna conversación, y borrar un chat no
  -- puede llevarse puesto el balance que alguien guardó.
  conversacion_id uuid,

  titulo text not null check (length(btrim(titulo)) between 1 and 200),

  -- La descripción completa del documento, ya normalizada. Es lo único que hace
  -- falta para volver a dibujarlo.
  especificacion jsonb not null,

  -- El formato en que se pidió originalmente, para que el enlace del chat
  -- ofrezca ese primero. Los otros dos siguen disponibles igual.
  formato text not null default 'excel'
    check (formato in ('excel', 'pdf', 'word')),

  -- Qué se tuvo que recortar al normalizar (una tabla enorme, una lista larga).
  -- Se guarda para poder decirlo en pantalla en vez de que el usuario descubra
  -- solo que le faltan filas.
  recortes text[] not null default '{}',

  creado_en timestamptz not null default now()
);

comment on table public.eos_documentos_generados is
  'Documentos que EOS armó a pedido. Se guarda la descripción, no el binario: el archivo se dibuja en cada descarga.';

create index if not exists eos_documentos_generados_usuario_idx
  on public.eos_documentos_generados (usuario_id, creado_en desc);

-- ============================================================
-- RLS
-- ============================================================
--
-- Lectura: solo el dueño. Escritura: SOLO el servidor. Si `authenticated`
-- pudiera insertar acá, cualquiera podría guardar una `especificacion` armada
-- a mano —sin pasar por el normalizador— y hacer que el renderizador trabaje
-- con datos que nadie validó.

alter table public.eos_documentos_generados enable row level security;

drop policy if exists documentos_generados_select on public.eos_documentos_generados;
create policy documentos_generados_select on public.eos_documentos_generados
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_documentos_generados from anon, authenticated;
grant select on table public.eos_documentos_generados to authenticated;
grant select, insert, delete on table public.eos_documentos_generados to service_role;
