-- Los chats se pueden archivar y eliminar desde el menú de tres puntos de la
-- barra lateral.
--
-- ARCHIVAR es una marca con fecha, no un estado aparte: `archivada_at` en
-- null es un chat de la lista; con fecha, está en "Archivados". Se guarda
-- cuándo porque es lo único que dice algo útil si alguien pregunta "¿cuándo
-- lo guardé?", y cuesta lo mismo que un booleano.
--
-- No hace falta ninguna política nueva: la de update de `conversaciones`
-- (v1, `conversaciones_update_propias`) ya deja a cada persona cambiar las
-- suyas, que es exactamente lo que archivar y renombrar necesitan.
--
-- ELIMINAR ya lo permitía `conversaciones_delete_propias`, y los mensajes se
-- van con la conversación (`mensajes_conversacion_id_fkey` es on delete
-- cascade). Lo que lo impedía era el vínculo de WhatsApp: su
-- `conversacion_id` se creó sin regla de borrado (v162), así que eliminar el
-- chat "WhatsApp" fallaba por la foránea. Pasa a `on delete set null`, igual
-- que las demás tablas que apuntan a una conversación (memoria, objetivos,
-- decisiones). El webhook ya contempla el vínculo sin conversación: el
-- próximo mensaje que llegue por WhatsApp abre una nueva.
--
-- Si esta migración no corrió, archivar devuelve error y la pantalla lo dice;
-- la lista sigue mostrando todos los chats como hasta ahora.

alter table public.conversaciones
  add column if not exists archivada_at timestamptz;

alter table public.eos_whatsapp_vinculos_v162
  drop constraint if exists eos_whatsapp_vinculos_v162_conversacion_id_fkey;

alter table public.eos_whatsapp_vinculos_v162
  add constraint eos_whatsapp_vinculos_v162_conversacion_id_fkey
  foreign key (conversacion_id)
  references public.conversaciones(id)
  on delete set null;
