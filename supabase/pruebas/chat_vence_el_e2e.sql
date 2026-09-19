-- Prueba de la v182: el chat traduce "me paga el 30" / "en 15 días" a un vencimiento.
--
-- Se corre DESPUÉS de la migración, en una transacción con rollback:
--
--     cat supabase/migrations/20260919140000_eos_chat_vence_el_v182.sql \
--         supabase/pruebas/chat_vence_el_e2e.sql > /tmp/e2e182.sql
--     npx supabase db query --linked -f /tmp/e2e182.sql
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
  hoy date := public.eos_hoy_py();
  dia_hoy integer := extract(day from public.eos_hoy_py())::integer;
  ultimo_este_mes integer;
  v date;
  ua uuid := gen_random_uuid();
  r jsonb;
  cmd uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  ultimo_este_mes := extract(day from (date_trunc('month', hoy) + interval '1 month' - interval '1 day'))::integer;

  -- ---------------------------------------------------------- la cuenta
  perform pg_temp.chk('al contado NO hay vencimiento, aunque manden uno',
    public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": 15}'::jsonb, 'contado') is null);
  perform pg_temp.chk('sin datos de vencimiento, no se inventa uno',
    public.eos_vencimiento_desde_datos_v182('{"condicion": "credito"}'::jsonb, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182(null, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182('[]'::jsonb, 'credito') is null);

  perform pg_temp.chk('"en 15 días" es hoy + 15',
    public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": 15}'::jsonb, 'credito') = hoy + 15);
  perform pg_temp.chk('lo mismo si el modelo lo manda como texto',
    public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": "30"}'::jsonb, 'credito') = hoy + 30);
  perform pg_temp.chk('"a 0 días" es hoy',
    public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": 0}'::jsonb, 'credito') = hoy);
  perform pg_temp.chk('un plazo absurdo o mal escrito se descarta',
    public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": 400}'::jsonb, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": -3}'::jsonb, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182('{"vence_en_dias": "pronto"}'::jsonb, 'credito') is null);

  -- "Me paga el día D": este mes si todavía no pasó.
  perform pg_temp.chk('"el día de hoy" es hoy',
    public.eos_vencimiento_desde_datos_v182(jsonb_build_object('vence_dia', dia_hoy), 'credito') = hoy);

  if dia_hoy < ultimo_este_mes then
    perform pg_temp.chk('un día que todavía no pasó es de ESTE mes',
      public.eos_vencimiento_desde_datos_v182(jsonb_build_object('vence_dia', ultimo_este_mes), 'credito')
        = date_trunc('month', hoy)::date + (ultimo_este_mes - 1));
  end if;

  if dia_hoy > 1 then
    v := public.eos_vencimiento_desde_datos_v182(jsonb_build_object('vence_dia', dia_hoy - 1), 'credito');
    perform pg_temp.chk('un día que ya pasó es del mes que viene',
      v > hoy and v <= hoy + 32 and extract(day from v)::integer <= dia_hoy - 1 + 0, v::text);
  end if;

  perform pg_temp.chk('"el 31" en un mes más corto cae en el último día, no se rompe',
    public.eos_vencimiento_desde_datos_v182('{"vence_dia": 31}'::jsonb, 'credito') is not null);
  perform pg_temp.chk('un día fuera de 1 a 31 se descarta',
    public.eos_vencimiento_desde_datos_v182('{"vence_dia": 0}'::jsonb, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182('{"vence_dia": 45}'::jsonb, 'credito') is null);

  -- Fecha completa.
  perform pg_temp.chk('una fecha completa que dijeron se respeta',
    public.eos_vencimiento_desde_datos_v182(jsonb_build_object('vence_el', (hoy + 20)::text), 'credito') = hoy + 20);
  perform pg_temp.chk('una fecha que no existe se descarta en vez de romper la venta',
    public.eos_vencimiento_desde_datos_v182('{"vence_el": "2026-02-31"}'::jsonb, 'credito') is null);
  perform pg_temp.chk('una fecha de otro siglo es un error de dictado',
    public.eos_vencimiento_desde_datos_v182('{"vence_el": "2099-01-01"}'::jsonb, 'credito') is null
    and public.eos_vencimiento_desde_datos_v182('{"vence_el": "1990-01-01"}'::jsonb, 'credito') is null);
  perform pg_temp.chk('si hay fecha completa, manda sobre lo demás',
    public.eos_vencimiento_desde_datos_v182(
      jsonb_build_object('vence_el', (hoy + 20)::text, 'vence_en_dias', 5, 'vence_dia', 1), 'credito') = hoy + 20);
  perform pg_temp.chk('si la fecha completa no sirve, se cae a lo que sí',
    public.eos_vencimiento_desde_datos_v182('{"vence_el": "2026-02-31", "vence_en_dias": 7}'::jsonb, 'credito') = hoy + 7);

  -- ------------------------------------------- la compra por el chat, entera
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (ua, 'authenticated', 'authenticated', 'e2e-chatv-' || ua || '@test.invalid', '{}');

  -- Sin el módulo ERP contratado, el chat rechaza toda compra (EOS_ACCION_SIN_MODULO_ERP).
  insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen)
  values (ua, 'erp', 'activo', 'prueba');

  -- La compra deja marcada la orden que la creó: hace falta una orden real.
  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen)
  values (gen_random_uuid(), ua, gen_random_uuid(), 'REGISTRAR_COMPRA', md5(random()::text), 'n8n-worker-gated-rc1')
  returning id into cmd;

  begin
    r := public.eos_erp_registrar_compra_chat_v134(
      ua, cmd,
      jsonb_build_object(
        'items', jsonb_build_array(jsonb_build_object('concepto', 'Flete', 'cantidad', 1, 'total', 50000)),
        'condicion', 'credito', 'vence_en_dias', 10));

    perform pg_temp.chk('la compra por el chat a crédito guarda el vencimiento calculado',
      (select vence_el from public.eos_erp_compras where id = (r->>'primero')::uuid) = hoy + 10,
      r::text);
    perform pg_temp.chk('y se lo devuelve al chat para que lo diga',
      (r->>'vence_el')::date = hoy + 10);
  exception when others then
    perform pg_temp.chk('la compra por el chat a crédito guarda el vencimiento calculado', false, sqlerrm);
  end;

  insert into public.eos_action_commands (id, usuario_id, request_id, accion, input_fingerprint, origen)
  values (gen_random_uuid(), ua, gen_random_uuid(), 'REGISTRAR_COMPRA', md5(random()::text), 'n8n-worker-gated-rc1')
  returning id into cmd;

  begin
    r := public.eos_erp_registrar_compra_chat_v134(
      ua, cmd,
      jsonb_build_object(
        'items', jsonb_build_array(jsonb_build_object('concepto', 'Combustible', 'cantidad', 1, 'total', 100000)),
        'condicion', 'contado', 'vence_en_dias', 10));

    perform pg_temp.chk('al contado, el vencimiento que manden se ignora',
      (select vence_el from public.eos_erp_compras where id = (r->>'primero')::uuid) is null
      and (r->>'vence_el') is null, r::text);
  exception when others then
    perform pg_temp.chk('al contado, el vencimiento que manden se ignora', false, sqlerrm);
  end;
end $$;

-- Permisos: solo service_role.
set local role anon;
do $$
begin
  begin
    perform public.eos_vencimiento_desde_datos_v182('{}'::jsonb, 'credito');
    perform set_config('e2e.anon', 'si', true);
  exception when others then
    perform set_config('e2e.anon', 'no', true);
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.eos_vencimiento_desde_datos_v182('{}'::jsonb, 'credito');
    perform set_config('e2e.auth', 'si', true);
  exception when others then
    perform set_config('e2e.auth', 'no', true);
  end;
end $$;
reset role;

select pg_temp.chk('anon NO ejecuta la función', current_setting('e2e.anon') = 'no');
select pg_temp.chk('un usuario logueado NO ejecuta la función', current_setting('e2e.auth') = 'no');

select n, prueba, ok, detalle from _r order by n;

rollback;
