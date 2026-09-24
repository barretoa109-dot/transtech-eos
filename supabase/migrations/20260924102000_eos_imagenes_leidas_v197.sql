-- EOS — Lo que había en una imagen no se olvida en el mensaje siguiente (v197)
--
-- ============================================================
-- LO QUE PASÓ (24 de septiembre de 2026, una clienta real por WhatsApp)
-- ============================================================
--
-- Sofía mandó la captura de un pedido (prendas, precios en dólares, envío) y
-- pidió pasarlo a guaraníes: EOS lo hizo bien. En el mensaje siguiente —"sumale
-- el envío al costo de cada prenda", y después "estos", respondiendo a la misma
-- imagen— EOS preguntó "¿a qué productos?". Tenía la respuesta en la imagen,
-- pero la imagen solo existió para UN mensaje: a la conversación quedaba el pie
-- de foto ("5.933,26 dólar, pasar a guaraníes") y nada de lo que se veía.
--
-- ============================================================
-- QUÉ AGREGA
-- ============================================================
--
-- Cada imagen que entra al chat (web o WhatsApp) se lee UNA vez y se guarda el
-- texto de lo que se ve —productos, cantidades, precios, total— atado a la
-- conversación. En los mensajes siguientes de esa conversación el motor le pasa
-- al modelo las lecturas recientes, así "estos", "los de la foto" o "sumale el
-- envío" tienen a qué referirse sin que la persona repita nada.
--
-- Solo service_role: lo escribe y lo lee el motor, filtrando siempre por el
-- usuario y la conversación. No se muestra en pantalla.

create table if not exists public.eos_imagenes_leidas_v197 (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  conversacion_id uuid,
  request_id uuid,
  nombre text,
  contenido text not null,
  creado_en timestamptz not null default now()
);

create index if not exists eos_imagenes_leidas_v197_conv_idx
  on public.eos_imagenes_leidas_v197 (usuario_id, conversacion_id, creado_en desc);

alter table public.eos_imagenes_leidas_v197 enable row level security;

revoke all on table public.eos_imagenes_leidas_v197 from public, anon, authenticated;
grant select, insert, delete on table public.eos_imagenes_leidas_v197 to service_role;

comment on table public.eos_imagenes_leidas_v197 is
  'Texto de lo que se ve en cada imagen que entró al chat, por conversación, para que los mensajes siguientes puedan referirse a ella. Solo service_role.';
