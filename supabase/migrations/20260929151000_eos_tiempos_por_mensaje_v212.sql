-- v212: dónde se van los segundos de cada mensaje.
--
-- La meta del tablero de lanzamiento (encargado-02) es una mediana de menos de
-- 8 s. El 29/09/2026 se sabía el total (~7 s entre reservar y cerrar el cupo,
-- ~10 s de punta a punta en la web) y que el modelo solo tarda ~3 s según la
-- batería. El resto no tenía nombre.
--
-- La app escribe acá las etapas de cada mensaje, en milisegundos desde que
-- empezó a procesarlo (lib/eos/tiempos.ts). Va en la fila de la reserva de
-- cupo porque ya existe una por mensaje y ya está atada al usuario y al
-- request_id: no hace falta otra tabla ni otro permiso.
--
-- Solo la escribe el service role, igual que el resto de la tabla. No guarda
-- nada del contenido del mensaje.

alter table public.eos_message_usage_v40
  add column if not exists tiempos jsonb;

comment on column public.eos_message_usage_v40.tiempos is
  'Etapas del mensaje en ms desde el comienzo (contexto, cupo, respuesta, cierre, fin) más duración del modelo y de las acciones. Lo escribe lib/eos/tiempos.ts.';
