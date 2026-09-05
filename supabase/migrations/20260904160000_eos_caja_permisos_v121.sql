-- La caja no se puede vaciar de un saque (v121).
--
-- ============================================================
-- LO QUE `revoke ... from anon` NO ALCANZABA
-- ============================================================
--
-- La v120 revocó todo a `anon` —la regla de siempre, porque la clave pública
-- está en el JavaScript del navegador— y otorgó a `authenticated` exactamente
-- lo que hace falta:
--
--     grant select, insert, update, delete ... to authenticated;
--
-- Eso NO alcanzó. Supabase tiene un `alter default privileges` sobre el
-- esquema público que ya le había dado `all` a `authenticated` cuando la tabla
-- se creó, y un `grant` de cuatro permisos no quita los otros tres. Verificado
-- contra producción después de aplicar la v120:
--
--     eos_empresa_cajas_v120 = DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
--                              TRUNCATE, UPDATE
--     eos_erp_ventas         = DELETE, INSERT, SELECT, UPDATE
--
-- ============================================================
-- POR QUÉ TRUNCATE ES EL QUE IMPORTA
-- ============================================================
--
-- **TRUNCATE no pasa por RLS.** Un `delete` que la policy no permite no borra
-- nada; un `truncate` vacía la tabla entera, de todas las empresas, sin que
-- ninguna policy lo mire.
--
-- `TRIGGER` y `REFERENCES` son menos graves —crear triggers y claves foráneas
-- sobre la tabla— pero tampoco los necesita nadie desde el cliente, y un
-- permiso que sobra es superficie que hay que explicar cada vez que alguien
-- audita.
--
-- ============================================================
-- HAY OTRAS DIECINUEVE TABLAS ASÍ, Y NO SE TOCAN ACÁ
-- ============================================================
--
-- Buscando esto apareció que el mismo exceso lo tienen otras diecinueve tablas
-- del esquema, incluidas `eos_movimientos_financieros`, `eos_finanzas_cuentas`
-- y `eos_finanzas_deudas`, que son las de plata de la persona. Las del ERP
-- —`eos_erp_ventas` y compañía— sí lo tienen revocado, así que el estándar del
-- repositorio ya era este; lo que falta es aplicarlo parejo.
--
-- Esta migración arregla SOLO la tabla que introdujo el cambio de hoy. Las
-- otras diecinueve son una limpieza aparte, sobre tablas que este cambio no
-- tocó, y merecen su propia revisión: mezclarlas acá haría que un arreglo de
-- una línea entre en producción junto con diecinueve que nadie miró.

revoke all on table public.eos_empresa_cajas_v120 from authenticated;

-- Exactamente lo que la pantalla necesita. `delete` queda porque cerrar una
-- caja se hace con `activa = false`, pero borrarla del todo tiene que ser
-- posible mientras no tenga historia colgando.
grant select, insert, update, delete on table public.eos_empresa_cajas_v120 to authenticated;

-- Y el candado de siempre, por si alguna vez se vuelve a otorgar por defecto.
revoke all on table public.eos_empresa_cajas_v120 from anon;

do $$
declare
  v_sobra text;
begin
  select string_agg(privilege_type, ',' order by privilege_type) into v_sobra
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'eos_empresa_cajas_v120'
    and grantee = 'authenticated'
    and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  if v_sobra is not null then
    raise exception 'v121: a authenticated todavía le sobran permisos sobre la caja: %', v_sobra;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'eos_empresa_cajas_v120' and grantee = 'anon'
  ) then
    raise exception 'v121: anon todavía alcanza la caja.';
  end if;

  raise notice 'v121: la caja queda con select/insert/update/delete y nada más.';
end $$;
