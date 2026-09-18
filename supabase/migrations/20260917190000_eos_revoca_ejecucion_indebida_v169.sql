-- El REVOKE FROM PUBLIC no revocaba nada: 18 funciones SECURITY DEFINER
-- quedaban ejecutables por `anon`, y una de ellas sin ningún otro candado.
--
-- ============================================================
-- CÓMO SE ENCONTRÓ
-- ============================================================
--
-- Auditoría de seguridad (Supabase Advisors, `security_definer_function_*`):
-- 18 funciones `SECURITY DEFINER` ejecutables por `anon` vía
-- `/rest/v1/rpc/<función>`, 34 por `authenticated`. Varias de ellas —
-- `eos_borrar_mis_datos_v55`, `eos_erp_registrar_venta`,
-- `eos_finanzas_registrar_correo_v53`— tienen en su propia migración un
-- `revoke all on function ... from public;` escrito a propósito para
-- cerrarlas. El candado no estaba cerrado.
--
-- La razón está en `20260731000000_eos_privilegios_default_v0.sql`: hay un
-- `alter default privileges ... grant execute on functions to postgres,
-- anon, authenticated, service_role` que le da EXECUTE a esos CUATRO roles
-- de forma DIRECTA (no vía el rol `PUBLIC`) en el momento en que se crea
-- cada función. `revoke all on function X from public` revoca lo que tiene
-- el pseudo-rol `PUBLIC`, que es un rol DISTINTO de `anon`/`authenticated`:
-- el grant directo a esos dos roles queda intacto. Confirmado contra
-- `information_schema.routine_privileges`: `eos_finanzas_registrar_correo_v53`
-- tenía EXECUTE otorgado a `service_role`, `authenticated`, `anon` y
-- `postgres`, los cuatro, pese a su propio `revoke ... from public`.
--
-- Todas las migraciones de este repo que quisieron restringir una función
-- (`v55`, `v56`, `v53`, `v75`, `v69`) tienen el mismo patrón sin efecto real
-- sobre `anon`/`authenticated`. Se corrige acá una sola vez, para las 18 que
-- el advisor señaló, en vez de reescribir cada migración vieja.
--
-- ============================================================
-- LA ÚNICA QUE ERA EXPLOTABLE DE VERDAD
-- ============================================================
--
-- `eos_finanzas_registrar_correo_v53(p_usuario_id uuid)` no valida nada: ni
-- `auth.uid()`, ni `auth.role()`. Cualquiera con la clave `anon` —pública,
-- va en el bundle de cualquier cliente— podía llamar
-- `/rest/v1/rpc/eos_finanzas_registrar_correo_v53` con el `usuario_id` de
-- cualquier persona y pisarle `correos_recibidos`/`ultimo_correo_en` en
-- `eos_finanzas_buzon`. No expone datos ni permite inyectar movimientos
-- financieros (eso lo hace el webhook de Resend, que sí verifica firma), pero
-- es una escritura no autenticada sobre la fila de otro usuario — exactamente
-- lo que pide auditar el punto 7 del encargo. Solo la llama
-- `app/api/finanzas/correo/route.ts` con el cliente admin (`service_role`),
-- así que restringirla a ese rol no rompe nada.
--
-- ============================================================
-- LAS OTRAS 17: NINGUNA ERA EXPLOTABLE, TODAS QUEDAN MÁS ANGOSTAS
-- ============================================================
--
-- Revisada una por una (leyendo su cuerpo, no solo el nombre):
--
-- * 9 son funciones de TRIGGER (`returns trigger`): nunca se llaman por RPC
--   —Postgres las invoca solo, y `NEW`/`OLD` no existen fuera de ese
--   contexto—, y ningún archivo del repo las llama directo (grep sin
--   resultados). Disparar un trigger NO depende del privilegio EXECUTE sobre
--   la función: depende del privilegio sobre la TABLA. Revocarles EXECUTE a
--   los cuatro roles no afecta que sigan disparándose solas.
-- * 6 ya validan `auth.uid() is null` y fallan si no hay sesión: llamarlas
--   como `anon` ya era inofensivo, pero no tenían por qué estar expuestas.
-- * 2 (`eos_erp_registrar_venta`, `eos_finalize_message_quota_server_v75`)
--   ya exigen `auth.role() = 'service_role'`: cualquier llamada de `anon` o
--   `authenticated` ya fallaba, pero de nuevo, no tenían por qué estar
--   expuestas a esos dos roles.
--
-- Se revoca por higiene y para que el advisor deje de marcarlas, no porque
-- hubiera un agujero — salvo la primera de esta sección.
--
-- ============================================================
-- POR QUÉ NOMBRAR LOS ROLES Y NO "FROM PUBLIC"
-- ============================================================
--
-- Es justamente el error que esta migración corrige. `revoke execute on
-- function X from anon, authenticated;` nombra los roles reales, así que no
-- depende de si `PUBLIC` tiene o no el privilegio.

-- ------------------------------------------------------------
-- 1) La única explotable: solo service_role.
-- ------------------------------------------------------------
revoke execute on function public.eos_finanzas_registrar_correo_v53(uuid)
  from anon, authenticated;

-- ------------------------------------------------------------
-- 2) Ya se autoguardan con auth.uid(): fuera de anon, quedan para
--    authenticated (las llama el usuario dueño de la sesión).
-- ------------------------------------------------------------
revoke execute on function public.eos_auditoria_verificar_v60() from anon;
revoke execute on function public.eos_borrar_mis_datos_v55() from anon;
revoke execute on function public.eos_exportar_mis_datos_v56() from anon;
revoke execute on function public.eos_finanzas_obtener_buzon_v53() from anon;
revoke execute on function public.eos_mis_modulos() from anon;
revoke execute on function public.eos_tengo_modulo(text) from anon;

-- ------------------------------------------------------------
-- 3) Ya se autoguardan con auth.role() = 'service_role': fuera de anon y
--    authenticated, solo el backend con la service key las necesita.
-- ------------------------------------------------------------
revoke execute on function public.eos_erp_registrar_venta(
  uuid, jsonb, uuid, date, text, text, boolean, text, date
) from anon, authenticated;

revoke execute on function public.eos_finalize_message_quota_server_v75(
  uuid, uuid, bigint, bigint, numeric
) from anon, authenticated;

-- ------------------------------------------------------------
-- 4) Funciones de trigger: ningún rol necesita llamarlas por RPC.
-- ------------------------------------------------------------
revoke execute on function public.eos_activar_armado_al_pagar_v66()
  from anon, authenticated, service_role;
revoke execute on function public.eos_crear_empresa_inicial_v109()
  from anon, authenticated, service_role;
revoke execute on function public.eos_crm_deshacer_por_anulacion_v103()
  from anon, authenticated, service_role;
revoke execute on function public.eos_crm_ganar_por_venta_v103()
  from anon, authenticated, service_role;
revoke execute on function public.eos_empresa_heredar_v110()
  from anon, authenticated, service_role;
revoke execute on function public.eos_erp_bloquear_anulacion_con_cobranzas_v107()
  from anon, authenticated, service_role;
revoke execute on function public.eos_erp_kardex_valorizar_v108()
  from anon, authenticated, service_role;
revoke execute on function public.eos_finanzas_set_usuario_id()
  from anon, authenticated, service_role;
revoke execute on function public.mensajes_set_usuario_id()
  from anon, authenticated, service_role;
