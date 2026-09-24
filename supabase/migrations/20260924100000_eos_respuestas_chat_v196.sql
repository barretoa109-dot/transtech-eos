-- EOS — Que una respuesta del chat no se pierda si se corta la conexión (v196)
--
-- ============================================================
-- LO QUE PASÓ (24 de septiembre de 2026, usando EOS de verdad)
-- ============================================================
--
-- En medio de una conversación el chat mostró, dos veces seguidas, "Ahora
-- mismo no pude conectarme correctamente". Es el texto que la app muestra
-- cuando el `fetch` del navegador muere por la red: en el celular pasa si la
-- respuesta tarda más de lo que el sistema operativo deja abierta la conexión,
-- o si la app pasa a segundo plano.
--
-- Lo grave no era el aviso sino lo que se perdía: el servidor SIGUE trabajando
-- aunque el teléfono haya cortado. La respuesta se generaba, las acciones se
-- ejecutaban —una venta podía quedar cargada— y la persona recibía un error,
-- volvía a mandar el mensaje y arriesgaba cargarlo dos veces.
--
-- ============================================================
-- QUÉ AGREGA
-- ============================================================
--
-- Una tabla donde `/api/eos` deja la respuesta final de cada pedido, por su
-- `request_id` (que ahora genera el cliente). Si la conexión se corta, la app
-- la pide a `/api/eos/resultado` hasta que aparezca, en vez de mostrar error.
--
-- Solo service_role: la ruta de lectura filtra por el usuario de la sesión.
-- Se guarda lo mismo que ya viajó al navegador de esa persona, y cada
-- escritura borra las de más de un día del mismo usuario: no es un archivo,
-- es un buzón de paso.

create table if not exists public.eos_respuestas_chat_v196 (
  request_id uuid primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  estado_http integer not null,
  cuerpo jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists eos_respuestas_chat_v196_usuario_idx
  on public.eos_respuestas_chat_v196 (usuario_id, creado_en desc);

alter table public.eos_respuestas_chat_v196 enable row level security;

revoke all on table public.eos_respuestas_chat_v196 from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_respuestas_chat_v196 to service_role;

comment on table public.eos_respuestas_chat_v196 is
  'Respuesta final de cada pedido al chat, por request_id, para recuperarla si la conexión del cliente se cortó. Retención: un día. Solo service_role.';
