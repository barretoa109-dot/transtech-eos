-- Corregir el verificador de la v112 (v113).
--
-- ============================================================
-- UN VERIFICADOR QUE MIENTE ES PEOR QUE NINGUNO
-- ============================================================
--
-- `eos_empresa_funciones_pendientes_v112()` buscaba con
-- `prosrc like '%usuario_id = p_usuario_id%'`. En LIKE, el guion bajo es un
-- COMODÍN de un carácter: ese patrón también encuentra `usuarioXid = pYusuario`
-- y cualquier variante parecida.
--
-- El resultado fue un falso positivo real: reportó
-- `eos_erp_capturar_costo_anterior_v78` como pendiente cuando esa función ni
-- siquiera recibe `p_usuario_id` — es un trigger sin argumentos, y
-- `position('usuario_id = p_usuario_id' in prosrc)` da 0.
--
-- Importa más de lo que parece. Un chequeo que reporta algo que no pasa
-- enseña a ignorarlo, y la próxima vez que sí haya una función sin migrar
-- nadie va a mirar. Con `~` (regex) el guion bajo es un guion bajo.
--
-- El mismo error estaba en el filtro del bloque que reescribió las funciones,
-- pero ahí no causó daño: seleccionaba de más y la sustitución no encontraba
-- nada que cambiar, así que esas funciones quedaron intactas. Verificado
-- después: 14 funciones usan el helper y ninguna conserva el predicado viejo.

create or replace function public.eos_empresa_funciones_pendientes_v112()
returns table (funcion text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'eos\_erp\_%' or p.proname like 'eos\_crm\_%')
    -- `~` y no `like`: acá el guion bajo es un guion bajo.
    and p.prosrc ~ 'usuario_id = p_usuario_id'
  order by 1;
$$;

comment on function public.eos_empresa_funciones_pendientes_v112() is
  'v113: funciones de ERP/CRM que todavía filtran solo por usuario. Busca con regex, no con LIKE: el guion bajo de LIKE es comodín y daba falsos positivos.';

revoke all on function public.eos_empresa_funciones_pendientes_v112() from public, anon, authenticated;
grant execute on function public.eos_empresa_funciones_pendientes_v112() to service_role;
