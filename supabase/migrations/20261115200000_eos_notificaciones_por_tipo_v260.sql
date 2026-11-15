-- EOS — elegir qué notificaciones recibir, una por una (v260).
--
-- Hasta acá había un solo interruptor para el push de la app
-- (`avisos_motivacionales_push`, v258): las tres franjas del día se apagaban
-- juntas o no se apagaban. Quien quiere el consejo de la mañana pero no el
-- cierre de la noche solo podía elegir entre todo y nada, y el que elige
-- "nada" por una sola notificación que le molesta deja de recibir también las
-- que le servían.
--
-- Cuatro columnas nuevas en la misma tabla de siempre, todas en `true`: nadie
-- deja de recibir nada por esta migración. `avisos_motivacionales_push` sigue
-- existiendo y manda sobre las tres franjas (quien ya lo apagó, sigue apagado).
--
-- No cambia permisos ni políticas: la tabla ya tiene RLS por dueño y `anon`
-- revocado; las columnas nuevas heredan las dos cosas.

alter table public.eos_followup_preferences
  add column if not exists push_manana boolean not null default true,
  add column if not exists push_mediodia boolean not null default true,
  add column if not exists push_noche boolean not null default true,
  add column if not exists avisos_riesgo_push boolean not null default true;

comment on column public.eos_followup_preferences.push_manana is
  'false = no recibe el push de la mañana (objetivo o consejo; los lunes, el resumen de la semana).';
comment on column public.eos_followup_preferences.push_mediodia is
  'false = no recibe el push del mediodía (seguimiento y festejo de rachas).';
comment on column public.eos_followup_preferences.push_noche is
  'false = no recibe el push de la noche (cierre del día y racha en riesgo).';
comment on column public.eos_followup_preferences.avisos_riesgo_push is
  'false = los avisos de riesgo (plata y negocio) no le llegan a la app del teléfono; el correo se gobierna aparte con avisos_riesgo_correo.';
