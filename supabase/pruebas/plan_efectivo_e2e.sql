-- Prueba de la v228: un tramo de conversaciones pago y vigente cuenta para el cupo.
--
--     cat supabase/pruebas/plan_efectivo_e2e_inicio.sql \
--         supabase/migrations/20260930110000_eos_plan_efectivo_modulos_v228.sql \
--         supabase/pruebas/plan_efectivo_e2e.sql > /tmp/e2e228.sql
--     npx supabase db query --linked -f /tmp/e2e228.sql
--
-- Ya aplicada la v228, alcanza con el inicio + este archivo.
-- Termina en un error a propósito, con los resultados adentro: no queda nada
-- escrito. Usa cuentas sintéticas creadas adentro de la transacción.

create temp table _r (n serial, prueba text, ok boolean, detalle text);

create or replace function pg_temp.chk(p_prueba text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into _r (prueba, ok, detalle) values (p_prueba, coalesce(p_ok, false), p_detalle);
$$;

-- Una cuenta sintética con su plan, su vencimiento y, si se pide, un módulo.
create or replace function pg_temp.cuenta(
  p_plan text, p_vence timestamptz, p_modulo text, p_origen text, p_modulo_vence timestamptz
) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (u, 'authenticated', 'authenticated', 'e2e-v228-' || u || '@test.invalid', '{}');
  insert into public.usuarios (id, email, nombre)
  values (u, 'e2e-v228-' || u || '@test.invalid', 'E2E v228')
  on conflict (id) do nothing;
  update public.usuarios
  set plan = p_plan, plan_vencimiento = p_vence, estado_suscripcion = 'active'
  where id = u;
  -- Las cuentas nuevas no traen módulos; se limpia por si un trigger regala.
  delete from public.eos_usuario_modulos where usuario_id = u;
  if p_modulo is not null then
    insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen, vencimiento)
    values (u, p_modulo, 'activo', p_origen, p_modulo_vence);
  end if;
  return u;
end;
$$;

create or replace function pg_temp.reserva(p_usuario uuid) returns jsonb language plpgsql as $$
begin
  return public.eos_reserve_message_quota_server_v75(p_usuario, gen_random_uuid());
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

do $$
declare
  u uuid;
  r jsonb;
  manana timestamptz := now() + interval '20 days';
  ayer timestamptz := now() - interval '1 day';
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- 1. Free sin módulos: free.
  u := pg_temp.cuenta('free', null, null, null, null);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('free sin módulos: free y puede escribir',
    public.eos_plan_efectivo_v228(u) = 'free' and r->>'plan' = 'free' and (r->>'allowed')::boolean, r::text);

  -- 2. El caso de INC-09: plan free (por un armado sin conversaciones) y el
  --    tramo plus pago y vigente.
  u := pg_temp.cuenta('free', null, 'conversaciones_plus', 'pago', manana);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('INC-09: free + tramo plus pago vigente: cuenta como pro',
    public.eos_plan_efectivo_v228(u) = 'pro' and r->>'plan' = 'pro' and (r->>'allowed')::boolean, r::text);

  -- 3. Las cortesías no suben el plan (todas las cuentas viejas las tienen).
  u := pg_temp.cuenta('free', null, 'conversaciones_full', 'cortesia', null);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('cortesía sin vencimiento: sigue en free',
    public.eos_plan_efectivo_v228(u) = 'free' and r->>'plan' = 'free', r::text);

  -- 4. Tramo pago ya vencido: free.
  u := pg_temp.cuenta('free', null, 'conversaciones_plus', 'pago', ayer);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('tramo pago vencido: free',
    public.eos_plan_efectivo_v228(u) = 'free' and r->>'plan' = 'free', r::text);

  -- 5. Plan business vigente y un tramo menor pago: gana business.
  u := pg_temp.cuenta('business', manana, 'conversaciones', 'pago', manana);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('business vigente + tramo menor: business',
    public.eos_plan_efectivo_v228(u) = 'business' and r->>'plan' = 'business', r::text);

  -- 6. Plan pro vencido sin módulos: cae a free, como desde la v125.
  u := pg_temp.cuenta('pro', ayer, null, null, null);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('pro vencido sin módulos: free (sin cambios respecto de la v125)',
    public.eos_plan_efectivo_v228(u) = 'free' and r->>'plan' = 'free' and (r->>'allowed')::boolean, r::text);

  -- 7. Plan pro vencido pero el tramo plus pago sigue vigente: pro.
  u := pg_temp.cuenta('pro', ayer, 'conversaciones_plus', 'pago', manana);
  r := pg_temp.reserva(u);
  perform pg_temp.chk('pro vencido + tramo plus pago vigente: pro',
    public.eos_plan_efectivo_v228(u) = 'pro' and r->>'plan' = 'pro', r::text);

  -- 8. Módulo pago pero suspendido: no cuenta.
  u := pg_temp.cuenta('free', null, 'conversaciones_plus', 'pago', manana);
  update public.eos_usuario_modulos set estado = 'suspendido' where usuario_id = u;
  perform pg_temp.chk('tramo pago suspendido: free', public.eos_plan_efectivo_v228(u) = 'free',
    coalesce(public.eos_plan_efectivo_v228(u), 'null'));

  -- 9. Usuario inexistente: null, y la reserva sigue rechazando como antes.
  r := pg_temp.reserva(gen_random_uuid());
  perform pg_temp.chk('usuario inexistente: sin plan y la reserva falla',
    public.eos_plan_efectivo_v228(gen_random_uuid()) is null and r->>'error' like '%EOS_MESSAGE_PLAN_INVALID%', r::text);

  -- 10. Permisos: solo el servidor.
  perform pg_temp.chk('anon y authenticated no pueden ejecutar la función',
    not has_function_privilege('anon', 'public.eos_plan_efectivo_v228(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.eos_plan_efectivo_v228(uuid)', 'execute'));
end;
$$;

do $$ begin
  raise exception 'EOS_E2E_V228 %', (select json_agg(json_build_object('prueba', prueba, 'ok', ok, 'detalle', left(detalle, 200)) order by n) from _r);
end $$;
