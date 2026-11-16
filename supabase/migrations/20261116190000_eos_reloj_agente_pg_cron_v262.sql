-- El reloj del agente de pagos y de las notificaciones, dentro de la base (v262).
--
-- ============================================================
-- POR QUÉ
-- ============================================================
--
-- El agente de transferencias (`/api/cron/pagos-transferencia`) y el push
-- motivacional (`/api/cron/push-motivacional`) dependían de un `schedule` de
-- GitHub Actions. Medido el 2026-11-16: el de pagos, programado cada diez
-- minutos, no corrió NI UNA vez por su cuenta en casi cuatro horas, y el push
-- de la mañana y el del mediodía de ese día tampoco salieron. GitHub avisa que
-- sus `schedule` pueden atrasarse o saltearse; para un aviso motivacional es
-- molesto, para "tu pago se revisa las 24 horas" es incumplir lo prometido.
--
-- Vercel Hobby solo da dos crons diarios, ya usados. La base ya tiene
-- `pg_cron` corriendo tres trabajos cada cinco minutos sin fallar desde agosto:
-- se usa ese reloj.
--
-- ============================================================
-- CÓMO
-- ============================================================
--
-- `pg_cron` solo corre SQL. Para llamar a la web hace falta `pg_net`, y para
-- autenticarse, el mismo `CRON_SECRET` que usan los otros crons. El secreto NO
-- va en esta migración ni en el repositorio (que es público): se lee del Vault
-- de Supabase, con el nombre `eos_cron_secret`. Lo carga el dueño una vez:
--
--     select vault.create_secret('<el valor de CRON_SECRET>', 'eos_cron_secret');
--
-- Mientras no esté cargado, los trabajos corren y no hacen nada: ni llaman ni
-- fallan. Los workflows de GitHub quedan como respaldo; los dos endpoints son
-- idempotentes, así que una doble llamada no manda nada dos veces.

create extension if not exists pg_net;

create or replace function public.eos_llamar_cron_v262(p_ruta text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secreto text;
  v_pedido bigint;
begin
  -- Solo rutas de cron de EOS: esta función lleva el secreto en la cabecera,
  -- así que no puede servir para mandarlo a ninguna otra parte.
  if p_ruta is null or p_ruta !~ '^/api/cron/[a-z0-9/_-]+(\?[a-z0-9=&_-]+)?$' then
    raise exception 'EOS_CRON_RUTA_INVALIDA';
  end if;

  select s.decrypted_secret into v_secreto
  from vault.decrypted_secrets s
  where s.name = 'eos_cron_secret'
  limit 1;

  -- Sin secreto cargado no se llama: una llamada sin autorización solo
  -- llenaría el log de 401.
  if coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  select net.http_get(
    url := 'https://www.transtech.com.py' || p_ruta,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto)),
    timeout_milliseconds := 55000
  ) into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function public.eos_llamar_cron_v262(text) from public, anon, authenticated;
grant execute on function public.eos_llamar_cron_v262(text) to service_role;

comment on function public.eos_llamar_cron_v262(text) is
  'v262: llama a un endpoint /api/cron/* de EOS con el CRON_SECRET guardado en Vault (eos_cron_secret). Sin secreto no hace nada. La usan los trabajos de pg_cron.';

do $$
declare
  v_trabajo record;
  v_existente bigint;
begin
  for v_trabajo in
    select * from (values
      -- El agente de pagos: cada cinco minutos, todos los días.
      ('eos-pagos-transferencia-v262', '*/5 * * * *', '/api/cron/pagos-transferencia'),
      -- Las tres notificaciones del día (hora de Asunción = UTC-3).
      ('eos-push-manana-v262',   '0 12 * * *',  '/api/cron/push-motivacional?franja=manana'),
      ('eos-push-mediodia-v262', '30 16 * * *', '/api/cron/push-motivacional?franja=mediodia'),
      ('eos-push-noche-v262',    '0 22 * * *',  '/api/cron/push-motivacional?franja=noche')
    ) as t(nombre, horario, ruta)
  loop
    select jobid into v_existente from cron.job where jobname = v_trabajo.nombre limit 1;
    if v_existente is not null then
      perform cron.unschedule(v_existente);
    end if;

    perform cron.schedule(
      v_trabajo.nombre,
      v_trabajo.horario,
      format('select public.eos_llamar_cron_v262(%L);', v_trabajo.ruta)
    );
  end loop;
end;
$$;
