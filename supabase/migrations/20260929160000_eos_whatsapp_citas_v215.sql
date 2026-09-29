-- v215: "Responder" en WhatsApp — el mensaje citado le llega a EOS.
--
-- El 29/09/2026 Sofía citó una respuesta de EOS con el tipo de cambio adentro
-- y escribió "Aquí está". EOS contestó "No me llegó el dato": Meta manda solo
-- el id del mensaje citado (`context.id`) y el webhook lo tiraba.
--
-- Esta migración solo agrega dónde anotar ese id mientras el mensaje espera
-- en la sala de la ráfaga (v199): un álbum con un "Responder" en una de sus
-- partes tiene que llevar la cita al lote entero. El texto citado se busca en
-- `mensajes.metadata->'wa_ids'`, que ya existe (jsonb) y no necesita cambios.
--
-- `eos_whatsapp_rafaga_tomar_v199` devuelve `r.*`, así que la columna nueva
-- viaja sola. Idempotente.

alter table public.eos_whatsapp_rafaga_v199
  add column if not exists contexto_wa_id text;

comment on column public.eos_whatsapp_rafaga_v199.contexto_wa_id is
  'v215: id de WhatsApp del mensaje al que responde (context.id de Meta), si la persona usó "Responder". Ver lib/whatsapp/cita.ts.';
