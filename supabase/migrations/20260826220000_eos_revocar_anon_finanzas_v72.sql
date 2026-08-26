-- EOS — sacarle a `anon` el permiso sobre las tablas de plata
--
-- ============================================================
-- QUÉ SE ENCONTRÓ, Y CÓMO
-- ============================================================
--
-- Consultando la API REST con la **clave anónima** —la misma que viaja dentro
-- del bundle de JavaScript y que tiene cualquiera que abra las herramientas de
-- desarrollo— diez tablas contestan `200` en vez de `401`:
--
--   eos_finanzas_politica        eos_finanzas_cuentas
--   eos_movimientos_financieros  eos_finanzas_buzon
--   eos_finanzas_conciliaciones  eos_onboarding
--   eos_finanzas_fijos           eos_briefing_envios
--   eos_finanzas_deudas          eos_push_suscripciones
--
-- **Hoy no filtran nada**: devuelven cero filas, porque las políticas de RLS
-- comparan contra `auth.uid()` y un anónimo no tiene ninguno. La verificación
-- se hizo tabla por tabla y todas dieron cero.
--
-- Pero "no filtra" y "no puede filtrar" son cosas distintas. Mientras el
-- permiso exista, lo único que separa el saldo, las deudas y los movimientos de
-- todos los usuarios de cualquier persona con la clave pública es que ninguna
-- política se escriba mal ni una sola vez. Las tablas más nuevas del proyecto
-- (v60 en adelante) ya hacen `revoke all ... from anon, authenticated` y después
-- otorgan solo lo que hace falta; estas son de la primera tanda de finanzas
-- (v51-v61), de antes de que ese patrón se fijara.
--
-- ============================================================
-- POR QUÉ ESTO NO PUEDE ROMPER NADA
-- ============================================================
--
-- La aplicación nunca lee estas tablas sin sesión: el navegador consulta con el
-- token del usuario (rol `authenticated`) y el servidor con `service_role`. Se
-- revisó que ninguna pantalla pública las toque — la única lectura anónima que
-- existe es la de `planes` en la vitrine, y la única escritura anónima es la de
-- `leads` en el formulario de contacto. Ninguna de las dos está en esta lista.
--
-- Se revoca SOLO a `anon`. Los permisos de `authenticated` y `service_role`
-- quedan exactamente como estaban.

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'eos_finanzas_politica',
    'eos_movimientos_financieros',
    'eos_finanzas_conciliaciones',
    'eos_finanzas_fijos',
    'eos_finanzas_deudas',
    'eos_finanzas_cuentas',
    'eos_finanzas_buzon',
    'eos_onboarding',
    'eos_briefing_envios',
    'eos_push_suscripciones'
  ] loop
    -- `if exists`: la migración tiene que poder correr en una base donde alguna
    -- de estas tablas todavía no exista sin dejar a las demás sin aplicar.
    if to_regclass('public.' || v_tabla) is not null then
      execute format('revoke all on table public.%I from anon', v_tabla);
    end if;
  end loop;
end $$;

-- ============================================================
-- POR QUÉ NO SE TOCAN LOS "DEFAULT PRIVILEGES"
-- ============================================================
--
-- La tentación es correr
--
--   alter default privileges in schema public revoke all on tables from anon;
--
-- para que ninguna tabla futura vuelva a nacer abierta. No se hace, y la razón
-- es que en Supabase esos permisos permisivos son parte del diseño: la puerta
-- es la RLS, no el grant. Cambiarlo haría que una tabla creada desde el editor
-- del panel —con su política pública y todo— conteste 401 sin que nada explique
-- por qué, meses después, a alguien que no vio esta migración.
--
-- El patrón correcto ya lo usan las migraciones de la v60 en adelante, y es
-- explícito en cada tabla:
--
--   revoke all on table public.X from anon, authenticated;
--   grant select on table public.X to authenticated;
--
-- Eso es lo que hay que seguir haciendo en cada tabla nueva que guarde algo de
-- una persona.
