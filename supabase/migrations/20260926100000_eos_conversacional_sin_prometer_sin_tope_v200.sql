-- "EOS Conversacional" deja de decir "Sin tope de mensajes".
--
-- Regla del dueño (26/09/2026): todo plan tiene un tope. El cliente no lo ve,
-- y tampoco se le promete que no existe. La descripción de la v184 lo prometía
-- con esas palabras, y la pantalla de planes la muestra tal cual.
--
-- Solo cambia el texto. El cupo del módulo (-1) y el aviso interno de los 400
-- mensajes (v184) no se tocan acá. Idempotente: correrla dos veces no cambia
-- nada.

update public.eos_modulos
set descripcion = 'Para hablar con EOS todos los días, con toda tu memoria y tu contexto.'
where codigo = 'conversaciones_full'
  and descripcion is distinct from 'Para hablar con EOS todos los días, con toda tu memoria y tu contexto.';
