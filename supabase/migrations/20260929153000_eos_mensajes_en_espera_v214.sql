-- v214: cuando la IA no responde, el mensaje queda en espera y no se pierde.
--
-- Tarea encargado-08 del tablero de lanzamiento. Hasta hoy, si OpenAI se caía
-- o no contestaba, la persona esperaba hasta 110 s (20 s del gateway en
-- TypeScript más 90 s de n8n, que llama al mismo OpenAI) y recibía "probá
-- nuevamente". El mensaje se perdía si no lo volvía a escribir.
--
-- Ahora el gateway reconoce la caída (timeout, red, 429 o 5xx de OpenAI), guarda
-- el mensaje acá, contesta al instante que lo va a procesar en cuanto pueda, y
-- lib/eos/en-espera.ts lo reintenta cada 5 minutos. Cuando sale, la respuesta
-- llega por el mismo canal. Si no sale en una hora, se le avisa a la persona
-- que lo vuelva a mandar: nada se pierde en silencio.
--
-- Solo mensajes de texto: una foto o un audio no se guardan acá (el adjunto
-- puede vencer antes del reintento). Solo el service role toca esta tabla.

create table if not exists public.eos_mensajes_en_espera_v214 (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  conversacion_id uuid,
  origen text not null,
  mensaje text not null check (char_length(mensaje) between 1 and 4000),
  app_nativa boolean not null default false,
  estado text not null default 'esperando'
    check (estado in ('esperando', 'procesando', 'procesado', 'vencido')),
  intentos integer not null default 0,
  motivo text,
  proximo_intento_at timestamptz not null default now() + interval '1 minute',
  procesado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eos_mensajes_en_espera_v214_pendientes
  on public.eos_mensajes_en_espera_v214 (proximo_intento_at)
  where estado in ('esperando', 'procesando');

create index if not exists eos_mensajes_en_espera_v214_usuario
  on public.eos_mensajes_en_espera_v214 (usuario_id, created_at desc);

alter table public.eos_mensajes_en_espera_v214 enable row level security;

revoke all on table public.eos_mensajes_en_espera_v214 from public, anon, authenticated;
grant select, insert, update, delete on table public.eos_mensajes_en_espera_v214 to service_role;

comment on table public.eos_mensajes_en_espera_v214 is
  'Mensajes de texto que llegaron mientras la IA no respondía. Los reintenta lib/eos/en-espera.ts cada 5 minutos. Solo service_role.';
