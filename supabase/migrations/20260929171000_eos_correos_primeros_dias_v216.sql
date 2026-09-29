-- v216: los correos de la primera semana (inicio-04 del tablero de lanzamiento).
--
-- Tres correos que dependen de lo que hizo la persona (lib/email/primeros-dias.ts):
--   dia1  qué pedirle a EOS, con ejemplos de su rubro.
--   dia3  solo si todavía no anotó nada: una ayuda concreta.
--   dia7  lo que EOS hizo por ella esa semana, o qué la frenó.
--
-- La fila se inserta ANTES de mandar (reclamo): la clave primaria hace que dos
-- corridas del cron no manden el mismo correo dos veces. Si el envío falla, se
-- borra y el cron de mañana lo reintenta dentro de la misma ventana.
--
-- Solo el service role toca esta tabla.

create table if not exists public.eos_correos_primeros_dias_v216 (
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  paso text not null check (paso in ('dia1', 'dia3', 'dia7')),
  enviado_en timestamptz not null default now(),
  primary key (usuario_id, paso)
);

alter table public.eos_correos_primeros_dias_v216 enable row level security;

revoke all on table public.eos_correos_primeros_dias_v216 from public, anon, authenticated;
grant select, insert, delete on table public.eos_correos_primeros_dias_v216 to service_role;

comment on table public.eos_correos_primeros_dias_v216 is
  'Qué correo de la primera semana recibió cada cuenta (dia1, dia3, dia7). Lo escribe lib/email/primeros-dias.ts. Solo service_role.';
