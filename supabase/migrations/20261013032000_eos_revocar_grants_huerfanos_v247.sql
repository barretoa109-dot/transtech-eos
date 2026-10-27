-- Cerrar permisos de más que nadie pidió, parte de la auditoría previa al
-- lanzamiento al público (v247).
--
-- ============================================================
-- LO QUE SE ENCONTRÓ
-- ============================================================
--
-- `scripts/grants-sanos.mjs` (desde la v169/v171) solo revisa funciones
-- `SECURITY DEFINER`: las que corren con privilegios ajenos a quien llama, y
-- por eso las que más importan. Pero toda función nueva en este proyecto
-- recibe EXECUTE para PUBLIC y `anon` por default (comentario de ese mismo
-- script), sea o no SECURITY DEFINER — y una función SIN ese marcador, que
-- escribe en la base con los permisos de quien la invoca, también puede
-- hacer daño si queda alcanzable sin sesión: solo que el linter de hoy no
-- mira ese caso.
--
-- Confirmado contra producción (solo lectura): de las funciones con EXECUTE
-- para `anon` hoy, cuatro son lectura pura (IMMUTABLE/STABLE, sin tocar
-- ninguna tabla: `eos_auditoria_hash_v60`, `eos_hoy_py`, `eos_leer_monto`,
-- `eos_periodo_actual`) y quedan como están — abiertas a propósito, no hacen
-- daño. Las otras cuatro sí:
--
--   · `eos_generate_proactive_followups(timestamptz)`: VOLATILE, sin
--     SECURITY DEFINER, recorre TODOS los objetivos activos del sistema (sin
--     filtrar por usuario) e INSERTA seguimientos. Pensada para un cron
--     interno, queda invocable por cualquiera desde internet sin
--     autenticarse — una vez público, una superficie de abuso/gasto gratuita
--     (puede llamarse en bucle).
--   · `eos_ambito_del_movimiento`, `eos_caja_tocar_v120`,
--     `eos_preserve_memory_action_command_v60`: funciones de TRIGGER
--     (`returns trigger`). Invocarlas directo sin un INSERT/UPDATE real de
--     por medio no tiene efecto útil (les faltan NEW/OLD), pero el permiso
--     no debería existir igual — higiene, no explotación directa hoy.
--
-- Este archivo solo revoca: no cambia ninguna lógica, ningún dato, ninguna
-- firma. Verificado en una transacción con rollback contra producción antes
-- de escribir esto: después del revoke, `has_function_privilege('anon', ...)`
-- da `false` para las cuatro, y las llamadas desde `service_role` (que es
-- quien realmente las usa) siguen andando igual.

revoke all on function public.eos_generate_proactive_followups(timestamp with time zone)
  from public, anon;
grant execute on function public.eos_generate_proactive_followups(timestamp with time zone)
  to service_role;

revoke all on function public.eos_ambito_del_movimiento() from public, anon;
revoke all on function public.eos_caja_tocar_v120() from public, anon;
revoke all on function public.eos_preserve_memory_action_command_v60() from public, anon;
