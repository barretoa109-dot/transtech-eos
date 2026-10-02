-- v230: reportar una respuesta de EOS desde la app (01/10/2026).
--
-- La política de Google Play para apps con IA generativa exige que la persona
-- pueda reportar una respuesta ofensiva o dañina sin salir de la app. Cada
-- respuesta de EOS tiene un botón "Reportar" (web y app); el reporte queda
-- acá y le llega un correo al dueño (ADMIN_EMAILS) para revisarlo.
--
-- El extracto lo toma el SERVIDOR del mensaje guardado (mismo usuario), no lo
-- que manda el navegador; si el mensaje todavía no estaba guardado, se usa el
-- texto enviado, recortado.
--
-- Solo service_role. Rollback: drop table.

create table if not exists public.eos_reportes_respuesta_v230 (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  mensaje_id uuid,
  conversacion_id uuid,
  motivo text not null check (motivo in ('ofensivo', 'peligroso', 'incorrecto', 'otro')),
  comentario text check (comentario is null or length(comentario) <= 1000),
  extracto text not null check (length(extracto) <= 2000),
  canal text not null default 'web' check (canal in ('web', 'app')),
  revisado boolean not null default false,
  creado_en timestamptz not null default now()
);

create index if not exists eos_reportes_respuesta_v230_creado_idx
  on public.eos_reportes_respuesta_v230 (creado_en desc);

alter table public.eos_reportes_respuesta_v230 enable row level security;
revoke all on table public.eos_reportes_respuesta_v230 from public, anon, authenticated;
grant select, insert, update on table public.eos_reportes_respuesta_v230 to service_role;
grant usage on sequence public.eos_reportes_respuesta_v230_id_seq to service_role;

comment on table public.eos_reportes_respuesta_v230 is
  'Respuestas de EOS reportadas por la persona (política de IA de Google Play). Solo service_role.';
