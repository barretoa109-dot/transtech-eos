-- Segunda mitad de la v169: las funciones que además tenían grant a PUBLIC.
--
-- La v169 quitó los grants DIRECTOS a anon/authenticated que da el
-- `alter default privileges` de la v0. Al volver a correr el advisor de
-- Supabase quedaron 14 avisos de `anon`, y al mirar `routine_privileges` el
-- motivo es el otro camino: esas funciones nunca tuvieron un
-- `revoke ... from public`, y Postgres le da EXECUTE a `PUBLIC` por defecto
-- al crear cualquier función. `anon` hereda de `PUBLIC`.
--
-- Son dos mecanismos distintos y hacen falta los dos revokes:
--   * grant directo a anon/authenticated  → `revoke ... from anon, ...`  (v169)
--   * grant al pseudo-rol PUBLIC          → `revoke ... from public`     (esta)
--
-- Lo que cada función necesita para seguir andando (verificado en la v169):
--   * trigger: nadie las llama; disparar un trigger no requiere EXECUTE.
--   * eos_erp_registrar_venta / eos_finalize_message_quota_server_v75: las
--     llama el backend con service_role, que tiene su grant directo.
--   * eos_auditoria_verificar_v60 / eos_mis_modulos / eos_tengo_modulo: las
--     llama el usuario con sesión; `authenticated` tiene su grant directo
--     (confirmado en routine_privileges antes de escribir esto).
--
-- Se revoca solo de PUBLIC: los grants directos que hay que conservar no se
-- tocan.

revoke execute on function public.eos_activar_armado_al_pagar_v66() from public;
revoke execute on function public.eos_auditoria_verificar_v60() from public;
revoke execute on function public.eos_crear_empresa_inicial_v109() from public;
revoke execute on function public.eos_crm_deshacer_por_anulacion_v103() from public;
revoke execute on function public.eos_crm_ganar_por_venta_v103() from public;
revoke execute on function public.eos_empresa_heredar_v110() from public;
revoke execute on function public.eos_erp_bloquear_anulacion_con_cobranzas_v107() from public;
revoke execute on function public.eos_erp_kardex_valorizar_v108() from public;
revoke execute on function public.eos_erp_registrar_venta(
  uuid, jsonb, uuid, date, text, text, boolean, text, date
) from public;
revoke execute on function public.eos_finalize_message_quota_server_v75(
  uuid, uuid, bigint, bigint, numeric
) from public;
revoke execute on function public.eos_finanzas_set_usuario_id() from public;
revoke execute on function public.eos_mis_modulos() from public;
revoke execute on function public.eos_tengo_modulo(text) from public;
revoke execute on function public.mensajes_set_usuario_id() from public;
