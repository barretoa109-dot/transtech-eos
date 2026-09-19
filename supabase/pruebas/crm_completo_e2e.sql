-- Prueba de la v185: ficha del cliente, oportunidades, etapas, seguimientos y el
-- token de WhatsApp en Vault.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     cat supabase/migrations/20260919190000_eos_crm_completo_v185.sql \
--         supabase/pruebas/crm_completo_e2e.sql > /tmp/e2e185.sql
--     npx supabase db query --linked -f /tmp/e2e185.sql
--
-- Una vez aplicada la migración, se corre solo este archivo.

begin;

create temp table _r (n serial, prueba text, ok boolean, detalle text) on commit drop;

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ca uuid;
  cb uuid;
  contacto uuid;
  r jsonb;
  borrado boolean;
  ref1 uuid;
  ref2 uuid;
  ref3 uuid;
  secretoapp text := 'appsecret' || repeat('c', 32);
  token1 text := 'EAAG' || repeat('a', 60);
  token2 text := 'EAAG' || repeat('b', 60);
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-crm-a-' || ua || '@test.invalid', '{}'),
         (ub, 'authenticated', 'authenticated', 'e2e-crm-b-' || ub || '@test.invalid', '{}');

  -- ---------------------------------------------------------------- la ficha
  insert into public.eos_crm_contactos (usuario_id, nombre) values (ua, 'Carlos') returning id into contacto;

  perform pg_temp.chk('un cliente nuevo nace "activo" y sin próxima interacción',
    (select estado_relacion from public.eos_crm_contactos where id = contacto) = 'activo'
    and (select proxima_interaccion_en from public.eos_crm_contactos where id = contacto) is null);

  update public.eos_crm_contactos
     set empresa = 'Molino Sur SA', estado_relacion = 'prospecto',
         proxima_interaccion_en = current_date + 3, responsable_id = ua
   where id = contacto;
  perform pg_temp.chk('se guardan empresa, estado, próxima interacción y responsable',
    (select empresa || '|' || estado_relacion from public.eos_crm_contactos where id = contacto) = 'Molino Sur SA|prospecto');

  begin
    update public.eos_crm_contactos set estado_relacion = 'inventado' where id = contacto;
    perform pg_temp.chk('un estado inventado se rechaza', false, 'no lanzó');
  exception when check_violation then
    perform pg_temp.chk('un estado inventado se rechaza', true);
  end;

  -- ---------------------------------------------------------- oportunidades
  begin
    insert into public.eos_crm_oportunidades (usuario_id, contacto_id, titulo, probabilidad)
    values (ua, contacto, 'X', 101);
    perform pg_temp.chk('una probabilidad de 101 se rechaza', false, 'no lanzó');
  exception when check_violation then
    perform pg_temp.chk('una probabilidad de 101 se rechaza', true);
  end;

  insert into public.eos_crm_oportunidades (usuario_id, contacto_id, titulo, monto, probabilidad, producto_servicio, proxima_accion_en)
  values (ua, contacto, 'Plan empresarial', 3500000, 60, 'Plan empresarial', current_date + 2);
  perform pg_temp.chk('la oportunidad guarda probabilidad, producto y próxima acción',
    (select probabilidad || '|' || producto_servicio from public.eos_crm_oportunidades where usuario_id = ua limit 1) = '60|Plan empresarial');

  insert into public.eos_crm_oportunidades (usuario_id, contacto_id, titulo)
  values (ua, contacto, 'Sin estimar');
  perform pg_temp.chk('sin estimar, la probabilidad queda NULA (no es 0)',
    (select probabilidad from public.eos_crm_oportunidades where titulo = 'Sin estimar') is null);

  -- ----------------------------------------------------------------- etapas
  insert into public.eos_crm_etapas_config (usuario_id, etapa, etiqueta, orden, probabilidad_defecto)
  values (ua, 'propuesta', 'Presupuesto enviado', 3, 40);
  perform pg_temp.chk('una etapa se puede renombrar y darle probabilidad por defecto',
    (select etiqueta from public.eos_crm_etapas_config where usuario_id = ua and etapa = 'propuesta') = 'Presupuesto enviado');

  begin
    insert into public.eos_crm_etapas_config (usuario_id, etapa, etiqueta) values (ua, 'etapa_inventada', 'X');
    perform pg_temp.chk('no se pueden inventar códigos de etapa (son el contrato con los indicadores)', false, 'no lanzó');
  exception when check_violation then
    perform pg_temp.chk('no se pueden inventar códigos de etapa (son el contrato con los indicadores)', true);
  end;

  begin
    insert into public.eos_crm_etapas_config (usuario_id, etapa, etiqueta) values (ua, 'propuesta', 'Otra vez');
    perform pg_temp.chk('una etapa no se configura dos veces', false, 'no lanzó');
  exception when unique_violation then
    perform pg_temp.chk('una etapa no se configura dos veces', true);
  end;

  -- ------------------------------------------------------------ seguimientos
  insert into public.eos_crm_seguimientos_estado (usuario_id, clave, estado, hasta)
  values (ua, 'sin-respuesta:' || contacto, 'pospuesto', current_date + 3);
  perform pg_temp.chk('un seguimiento pospuesto se recuerda con su fecha',
    (select estado from public.eos_crm_seguimientos_estado where usuario_id = ua) = 'pospuesto');

  -- ------------------------------------------------- el token, en Vault
  insert into public.eos_wa_canales (usuario_id, phone_number_id, telefono, estado)
  values (ua, 'e2e-crm-pn-a-' || ua, '595971000001', 'pendiente') returning id into ca;
  insert into public.eos_wa_canales (usuario_id, phone_number_id, telefono, estado)
  values (ub, 'e2e-crm-pn-b-' || ub, '595971000002', 'pendiente') returning id into cb;

  ref1 := public.eos_wa_guardar_secreto_v185(ca, token1);
  perform pg_temp.chk('guardar el token deja una referencia en el canal',
    ref1 is not null and (select secreto_ref from public.eos_wa_canales where id = ca) = ref1);
  perform pg_temp.chk('el token se lee de vuelta, entero',
    public.eos_wa_leer_secreto_v185(ca) = token1);
  perform pg_temp.chk('la tabla de canales NO tiene el token en ninguna columna',
    (select to_jsonb(c)::text from public.eos_wa_canales c where c.id = ca) not like '%' || token1 || '%');

  ref2 := public.eos_wa_guardar_secreto_v185(ca, token2);
  perform pg_temp.chk('guardar de nuevo REEMPLAZA el token y conserva la referencia',
    ref2 = ref1 and public.eos_wa_leer_secreto_v185(ca) = token2
    and (select count(*) from vault.secrets where name = 'eos_wa_token_' || ca::text) = 1);

  perform pg_temp.chk('el token del canal B no se ve desde el A',
    public.eos_wa_leer_secreto_v185(cb) is null);

  begin
    perform public.eos_wa_guardar_secreto_v185(cb, 'corto');
    perform pg_temp.chk('un secreto demasiado corto se rechaza', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('un secreto demasiado corto se rechaza', sqlerrm like '%EOS_WA_SECRETO_INVALIDO%', sqlerrm);
  end;

  begin
    perform public.eos_wa_guardar_secreto_v185(cb, token1, 'inventado');
    perform pg_temp.chk('un tipo de secreto inventado se rechaza', false, 'no lanzó');
  exception when others then
    perform pg_temp.chk('un tipo de secreto inventado se rechaza', sqlerrm like '%EOS_WA_SECRETO_TIPO_INVALIDO%', sqlerrm);
  end;

  -- El secreto de la app (con el que Meta firma los mensajes que entran).
  ref3 := public.eos_wa_guardar_secreto_v185(ca, secretoapp, 'app');
  perform pg_temp.chk('el secreto de la app se guarda aparte, con su propia referencia',
    ref3 is not null and ref3 <> ref1
    and (select secreto_app_ref from public.eos_wa_canales where id = ca) = ref3
    and public.eos_wa_leer_secreto_v185(ca, 'app') = secretoapp
    and public.eos_wa_leer_secreto_v185(ca, 'token') = token2);
  perform pg_temp.chk('desde el número de teléfono se resuelve el secreto de la app de ESE canal',
    public.eos_wa_secreto_app_de_numero_v185((select phone_number_id from public.eos_wa_canales where id = ca)) = secretoapp
    and public.eos_wa_secreto_app_de_numero_v185('numero-que-no-existe') is null
    and public.eos_wa_secreto_app_de_numero_v185((select phone_number_id from public.eos_wa_canales where id = cb)) is null);

  update public.eos_wa_canales set verify_token = 'verif-e2e-' || ca::text where id = ca;
  begin
    update public.eos_wa_canales set verify_token = 'verif-e2e-' || ca::text where id = cb;
    perform pg_temp.chk('dos canales no pueden compartir el token de verificación', false, 'no lanzó');
  exception when unique_violation then
    perform pg_temp.chk('dos canales no pueden compartir el token de verificación', true);
  end;

  -- Primero se borra, DESPUÉS se mira: dentro de una misma sentencia, las
  -- subconsultas no ven lo que una función volátil escribe en esa sentencia.
  borrado := public.eos_wa_borrar_secreto_v185(ca);

  perform pg_temp.chk('desconectar borra LOS DOS secretos de Vault y limpia las referencias',
    borrado = true
    and (select secreto_ref from public.eos_wa_canales where id = ca) is null
    and (select secreto_app_ref from public.eos_wa_canales where id = ca) is null
    and (select count(*) from vault.secrets where name in ('eos_wa_token_' || ca::text, 'eos_wa_app_' || ca::text)) = 0
    and public.eos_wa_leer_secreto_v185(ca) is null
    and public.eos_wa_leer_secreto_v185(ca, 'app') is null);

  -- Un cliente que llega por WhatsApp entra como prospecto.
  r := public.eos_wa_recibir_v177(cb, 'wamid-crm-1', '595985111222', 'Hola, ¿cuánto cuesta?', 'texto', 'Marta', now(), 'consulta_precio');
  perform pg_temp.chk('quien escribe por WhatsApp entra como prospecto',
    (select estado_relacion from public.eos_crm_contactos where id = (r->>'contacto_id')::uuid) = 'prospecto');

  perform set_config('e2e.ua', ua::text, false);
  perform set_config('e2e.ub', ub::text, false);
  perform set_config('e2e.ca', ca::text, false);
end $$;

-- ---------------------------------------------------------------- permisos y RLS
-- Una empresa no ve la configuración ni los seguimientos de la otra.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('e2e.ub'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('e2e.b_etapas', (select count(*) from public.eos_crm_etapas_config)::text, true);
select set_config('e2e.b_seg', (select count(*) from public.eos_crm_seguimientos_estado)::text, true);
select set_config('request.jwt.claim.sub', current_setting('e2e.ua'), true);
select set_config('e2e.a_etapas', (select count(*) from public.eos_crm_etapas_config)::text, true);
select set_config('e2e.a_seg', (select count(*) from public.eos_crm_seguimientos_estado)::text, true);

do $$
begin
  begin
    perform count(*) from vault.decrypted_secrets;
    perform set_config('e2e.vault_auth', 'si', true);
  exception when others then
    perform set_config('e2e.vault_auth', 'no', true);
  end;
  begin
    perform public.eos_wa_leer_secreto_v185(current_setting('e2e.ca')::uuid);
    perform set_config('e2e.leer_auth', 'si', true);
  exception when others then
    perform set_config('e2e.leer_auth', 'no', true);
  end;
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.eos_wa_leer_secreto_v185(gen_random_uuid());
    perform set_config('e2e.leer_anon', 'si', true);
  exception when others then
    perform set_config('e2e.leer_anon', 'no', true);
  end;
  begin
    perform count(*) from public.eos_crm_etapas_config;
    perform set_config('e2e.tabla_anon', 'si', true);
  exception when others then
    perform set_config('e2e.tabla_anon', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('RLS: la empresa B no ve la configuración de etapas de la A', current_setting('e2e.b_etapas')::int = 0, current_setting('e2e.b_etapas'));
select pg_temp.chk('RLS: la empresa B no ve los seguimientos de la A', current_setting('e2e.b_seg')::int = 0, current_setting('e2e.b_seg'));
select pg_temp.chk('RLS: la empresa A sí ve lo suyo', current_setting('e2e.a_etapas')::int = 1 and current_setting('e2e.a_seg')::int = 1);
select pg_temp.chk('un usuario logueado NO puede leer Vault', current_setting('e2e.vault_auth') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta leer_secreto', current_setting('e2e.leer_auth') = 'no');
select pg_temp.chk('anon NO ejecuta leer_secreto', current_setting('e2e.leer_anon') = 'no');
select pg_temp.chk('anon NO lee las tablas nuevas', current_setting('e2e.tabla_anon') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
