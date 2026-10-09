-- Un miembro de la empresa ve el negocio y nunca la plata personal del dueño
-- (09/10/2026). De punta a punta en la base real.
--
--     npx supabase db query --linked -f supabase/pruebas/miembro_empresa_sin_plata_personal_e2e.sql
--
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Cuentas sintéticas.
--
-- ============================================================
-- POR QUÉ ESTA PRUEBA
-- ============================================================
--
-- El T02 de la sección 20 del encargo del 08/10 ("Miembro consulta finanzas
-- personales del dueño" → "Denegado en API, chat, exportación y memoria") y
-- el punto 8 del propio encargo ("Un miembro de la empresa no obtiene acceso
-- a finanzas personales del dueño por compartir organización") son distintos
-- de todo lo que ya se probó hoy: `invariantes_financieras_e2e.sql` y
-- `cliente_venta_cobro_e2e.sql` aíslan DOS CUENTAS SEPARADAS, sin ninguna
-- relación entre ellas. Esto es el caso más delicado -- dos personas que SÍ
-- comparten una empresa de verdad (una ve las ventas de la otra) y aun así
-- una no puede ver la plata personal de la otra.
--
-- La v119 (04/09/2026) documenta la decisión de diseño: `eos_finanzas_cuentas`,
-- `eos_movimientos_financieros`, `eos_finanzas_fijos`, `eos_finanzas_deudas` y
-- `eos_finanzas_tarjetas` quedan A PROPÓSITO fuera de la frontera por empresa
-- -- siguen siendo por `usuario_id`, nunca por `empresa_id` -- "meterlos en
-- esta frontera le daría a un empleado las finanzas personales de su jefe".
-- Esta prueba verifica esa decisión contra la base real, no solo contra el
-- comentario que la explica.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  dueno uuid := gen_random_uuid();
  empleado uuid := gen_random_uuid();
  empresa_dueno uuid;
  cuenta_personal uuid;
  filas int;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (dueno, 'authenticated', 'authenticated', 'e2e-dueno-' || dueno || '@test.invalid', '{}'),
    (empleado, 'authenticated', 'authenticated', 'e2e-empleado-' || empleado || '@test.invalid', '{}');

  -- El trigger eos_crear_empresa_inicial_v109 ya le creó una empresa propia,
  -- activa, a cada uno. Tomamos la del dueño.
  select empresa_id into empresa_dueno from public.eos_empresa_miembros
    where usuario_id = dueno and rol = 'propietario';
  perform pg_temp.chk('el dueño tiene su empresa (la crea el trigger)', empresa_dueno is not null, coalesce(empresa_dueno::text, 'null'));

  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen) values
    (dueno, 'erp', 'activo', 'prueba');

  -- El dueño declara plata PERSONAL: esto es lo que el empleado nunca debe ver.
  insert into public.eos_finanzas_cuentas (usuario_id, ambito, nombre, tipo, moneda, saldo_declarado, saldo_declarado_el)
    values (dueno, 'personal', 'ZZ Cuenta Personal del Dueño', 'banco', 'PYG', 9000000, current_date)
    returning id into cuenta_personal;
  insert into public.eos_movimientos_financieros (usuario_id, ambito, tipo, monto, moneda, descripcion, origen)
    values (dueno, 'personal', 'gasto', 500000, 'PYG', 'ZZ Gasto personal del dueño', 'manual');

  -- El dueño registra una venta del NEGOCIO: esto el empleado SÍ tiene que ver.
  insert into public.eos_crm_contactos (usuario_id, empresa_id, nombre) values (dueno, empresa_dueno, 'ZZ Cliente del Negocio');
  insert into public.eos_erp_ventas (usuario_id, empresa_id, contacto_id, total, estado, condicion)
    select dueno, empresa_dueno, c.id, 300000, 'emitida', 'contado'
    from public.eos_crm_contactos c where c.usuario_id = dueno and c.nombre = 'ZZ Cliente del Negocio';

  -- Se invita al empleado a la empresa del dueño, con un rol que NO es
  -- propietario -- y se desactiva su propia empresa (la que también le creó
  -- el trigger), para que "su empresa activa" sea la del dueño, como
  -- cualquier invitado que cambia a trabajar ahí.
  update public.eos_empresa_miembros set activa = false where usuario_id = empleado;
  insert into public.eos_empresa_miembros (empresa_id, usuario_id, rol, activa)
    values (empresa_dueno, empleado, 'ventas', true);

  -- Se resuelve ANTES de cambiar de rol: eos_empresa_de_v109 es
  -- security definer, pero el resultado se necesita para una comprobación
  -- de más abajo y la tabla temporal no admite insert desde `authenticated`
  -- (ver el porqué de capturar todo en variables, abajo).
  declare
    v_empresa_activa_empleado uuid := public.eos_empresa_de_v109(empleado);
    v_ve_venta int;
    v_ve_contacto int;
    v_ve_cuenta_personal int;
    v_ve_alguna_cuenta_dueno int;
    v_ve_movimiento_personal int;
    v_suma_cuentas_dueno numeric;
  begin
    -- ---------------------------------------------------------------
    -- Con la sesión real del empleado (no service_role): RLS en vivo.
    --
    -- Todo se captura en variables ACÁ -- no se llama a pg_temp.chk()
    -- todavía -- porque la tabla temporal la creó la sesión original
    -- (service_role) y `authenticated` no tiene insert sobre ella. Llamar
    -- chk() en el medio no sería un matiz: sería tapar con un error de
    -- permisos del arnés la pregunta real que esta prueba hace.
    -- ---------------------------------------------------------------
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', empleado, 'role', 'authenticated')::text, true);

    select count(*) into v_ve_venta from public.eos_erp_ventas where contacto_id in (
      select id from public.eos_crm_contactos where nombre = 'ZZ Cliente del Negocio'
    );
    select count(*) into v_ve_contacto from public.eos_crm_contactos where nombre = 'ZZ Cliente del Negocio';
    select count(*) into v_ve_cuenta_personal from public.eos_finanzas_cuentas where id = cuenta_personal;
    select count(*) into v_ve_alguna_cuenta_dueno from public.eos_finanzas_cuentas where usuario_id = dueno;
    select count(*) into v_ve_movimiento_personal from public.eos_movimientos_financieros
      where descripcion = 'ZZ Gasto personal del dueño';
    select sum(saldo_declarado) into v_suma_cuentas_dueno from public.eos_finanzas_cuentas where usuario_id = dueno;

    reset role;

    -- Recién acá, de vuelta como el dueño de la transacción, se registran
    -- los resultados que se capturaron arriba.
    perform pg_temp.chk('la empresa activa del empleado ya es la del dueño',
      v_empresa_activa_empleado = empresa_dueno, coalesce(v_empresa_activa_empleado::text, 'null'));

    -- 1. El negocio SÍ se comparte: el empleado ve la venta y el cliente del dueño.
    perform pg_temp.chk('el empleado SÍ ve la venta del negocio (comparten empresa)', v_ve_venta = 1, v_ve_venta::text);
    perform pg_temp.chk('el empleado SÍ ve el cliente del negocio', v_ve_contacto = 1, v_ve_contacto::text);

    -- 2. La plata PERSONAL del dueño, no -- ni la cuenta, ni el movimiento.
    perform pg_temp.chk('el empleado NO ve la cuenta personal del dueño', v_ve_cuenta_personal = 0, v_ve_cuenta_personal::text);
    perform pg_temp.chk('el empleado no ve NINGUNA cuenta del dueño (por usuario_id, no por empresa)',
      v_ve_alguna_cuenta_dueno = 0, v_ve_alguna_cuenta_dueno::text);
    perform pg_temp.chk('el empleado NO ve el movimiento personal del dueño', v_ve_movimiento_personal = 0, v_ve_movimiento_personal::text);

    -- 3. Ni sumándolo a ciegas: un intento de leer "el total de cuentas que
    -- veo" no puede devolver el saldo personal del dueño disfrazado de cero
    -- filas con un total NULL que en el cliente se confunda con 0.
    perform pg_temp.chk('la suma de cuentas del dueño, vista por el empleado, es NULL (sin filas), no 0 ni 9.000.000',
      v_suma_cuentas_dueno is null, coalesce(v_suma_cuentas_dueno::text, 'null'));
  end;

  -- ---------------------------------------------------------------
  -- Y por si alguien confía en adminSinTipos() sin el filtro: con
  -- service_role sí se ve todo (es el camino que exige el .eq("usuario_id",…)
  -- en cada ruta, no la RLS). Confirma que el dato real existe donde
  -- corresponde, para que el "0" de arriba sea aislamiento y no un bug que
  -- perdió el dato.
  select count(*) into filas from public.eos_finanzas_cuentas where id = cuenta_personal;
  perform pg_temp.chk('con service_role, la cuenta del dueño SÍ existe (el 0 de arriba era RLS, no un dato perdido)',
    filas = 1, filas::text);
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_MIEMBRO_SIN_PLATA_PERSONAL %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 160)) order by n) from _r);
end $$;
