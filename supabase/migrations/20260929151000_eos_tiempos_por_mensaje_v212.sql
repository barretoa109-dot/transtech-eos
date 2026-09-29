-- v212: qué pasó en cada mensaje, sin guardar lo que dice.
--
-- La meta del tablero de lanzamiento (encargado-02) es una mediana de menos de
-- 8 s. El 29/09/2026 se sabía el total (~7 s entre reservar y cerrar el cupo,
-- ~10 s de punta a punta en la web) y que el modelo solo tarda ~3 s según la
-- batería. El resto no tenía nombre.
--
-- La app escribe acá, por cada mensaje (lib/eos/tiempos.ts):
--   - las etapas, en milisegundos desde que empezó a procesarlo (contexto,
--     cupo, respuesta, cierre, fin) y la duración del modelo y de las
--     acciones;
--   - quién atendió (ts, directa, n8n);
--   - si la respuesta afirmó haber anotado algo que quedó solo como memoria
--     (encargado-03) y cómo terminó cada acción (encargado-01).
-- Hasta hoy eso vivía solo en el log de Vercel, que se borra en una hora.
--
-- Va en la fila de la reserva de cupo porque ya existe una por mensaje y ya
-- está atada al usuario y al request_id: no hace falta otra tabla ni otro
-- permiso. Solo la escribe el service role, igual que el resto de la tabla.
-- Nunca guarda el texto del mensaje ni de la respuesta.

alter table public.eos_message_usage_v40
  add column if not exists turno jsonb;

comment on column public.eos_message_usage_v40.turno is
  'Qué pasó en el mensaje, sin su contenido: etapas en ms, gateway, solo_memoria y verificación de cada acción. Lo escribe lib/eos/tiempos.ts.';
