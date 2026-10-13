-- Arreglo urgente de un bug que introdujo la propia migración v242 (caja en
-- ERP, el mismo día). Al agregar `p_caja`/`p_caja_id` con CREATE OR REPLACE
-- FUNCTION, Postgres NO reemplazó las funciones existentes — como cambió la
-- cantidad de parámetros, creó una función nueva y separada, y dejó viva la
-- vieja. Dos problemas, confirmados en producción (13/10/2026, probando el
-- arreglo de la ventana de 30 días con un llamado real):
--
--   1. Seguridad: las tres funciones NUEVAS nacieron sin el revoke de
--      siempre, porque el linter de grants (`scripts/grants-sanos.mjs`)
--      identifica funciones por NOMBRE, no por firma completa, y las vio
--      como "ya existentes" (el nombre está desde antes del 2026-09-18).
--      Quedaron abiertas a `anon` — cualquiera con la clave pública del
--      proyecto podía llamarlas sin sesión. Ya se revocó a mano en
--      producción, de emergencia, antes de esta migración (con
--      autorización explícita del dueño); acá queda la revocación
--      permanente, para que sobreviva un `db reset`.
--   2. Funcional: las llamadas viejas que siguen usando la firma anterior
--      (dentro de `eos_erp_editar_compra` y `eos_erp_editar_venta`, que es
--      lo que usan CORREGIR_COMPRA, ANULAR_COMPRA, CORREGIR_VENTA y
--      ANULAR_VENTA para crear la versión corregida) quedaron AMBIGUAS para
--      Postgres: con la misma cantidad de argumentos coincidiendo con dos
--      funciones distintas, no puede elegir. Confirmado en vivo: un
--      CORREGIR_COMPRA real falló con `EOS_INTERNAL_EFFECT_DB_42725`
--      (ambiguous_function) en vez de aplicar la corrección.
--
-- El arreglo: borrar las tres funciones VIEJAS (sin `caja`). Las llamadas
-- que no mandan `caja` siguen funcionando igual que antes —el parámetro
-- tiene default NULL— y las que sí la mandan (venta cobrada, compra pagada,
-- cobranza) ya la usan desde la v242. Sin la vieja, no hay más ambigüedad.

drop function if exists public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text, date);
drop function if exists public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text, date);
drop function if exists public.eos_erp_registrar_cobranza_v107(uuid, uuid, uuid, numeric, date, text);

-- La revocación de emergencia, permanente (idempotente: ya corrida a mano).
revoke all on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_compra(uuid, jsonb, uuid, date, text, text, boolean, text, text, date, text)
  to service_role;

revoke all on function public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text, date, text)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_venta(uuid, jsonb, uuid, date, text, text, boolean, text, date, text)
  to service_role;

revoke all on function public.eos_erp_registrar_cobranza_v107(uuid, uuid, uuid, numeric, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.eos_erp_registrar_cobranza_v107(uuid, uuid, uuid, numeric, date, text, uuid)
  to service_role;
