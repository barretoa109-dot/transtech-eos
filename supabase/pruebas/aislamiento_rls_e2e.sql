-- ============================================================
-- Aislamiento entre cuentas y plan no autoasignable (v197)
-- ============================================================
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja filas.
-- Devuelve una fila por comprobación; todas tienen que dar ok = true.
--
--   npx supabase db query --linked -f supabase/pruebas/aislamiento_rls_e2e.sql
--
-- o contra una reconstrucción local (ver docs/lanzamiento/production-go-2026-09-24.md):
--
--   psql -d eos -f supabase/pruebas/aislamiento_rls_e2e.sql
--
-- Dos cuentas, A y B. A tiene datos en las tablas que más importan; B intenta
-- verlos y tocarlos con su propia sesión. Después A intenta darse un plan pago,
-- poner su consumo en cero y reescribir una aprobación. Y anon intenta leer.

begin;

create temporary table resultado (prueba text, ok boolean) on commit drop;
grant insert, select on resultado to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-4000-a000-00000000000a', 'qa-a@aislamiento.test', '{"nombre":"QA A"}'),
  ('00000000-0000-4000-a000-00000000000b', 'qa-b@aislamiento.test', '{"nombre":"QA B"}');

-- Por si el trigger de alta no existe en el entorno donde se corre.
insert into public.usuarios (id, email, nombre)
values
  ('00000000-0000-4000-a000-00000000000a', 'qa-a@aislamiento.test', 'QA A'),
  ('00000000-0000-4000-a000-00000000000b', 'qa-b@aislamiento.test', 'QA B')
on conflict (id) do nothing;

-- En una base reconstruida el catálogo de planes está vacío.
insert into public.planes (codigo, nombre) select 'pro', 'Pro'
where not exists (select 1 from public.planes where codigo = 'pro');

-- Datos de A, escritos por el servidor.
insert into public.conversaciones (id, usuario_id, titulo)
values ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000a', 'Conversación privada de A');
insert into public.mensajes (conversacion_id, usuario_id, rol, texto)
values ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000a', 'usuario', 'Vendí Gs. 1.500.000 hoy');
insert into public.memorias (usuario_id, contenido)
values ('00000000-0000-4000-a000-00000000000a', 'A tiene una ferretería');
insert into public.objetivos (usuario_id, titulo)
values ('00000000-0000-4000-a000-00000000000a', 'Facturar 100 millones');
insert into public.uso_mensual (usuario_id, periodo, mensajes_usados)
values ('00000000-0000-4000-a000-00000000000a', to_char(now(), 'YYYY-MM'), 40);
insert into public.solicitudes_pago (usuario_id, plan_codigo, periodicidad, monto, referencia_interna)
values ('00000000-0000-4000-a000-00000000000a', 'pro', 'mensual', 150000, 'QA-AISLAMIENTO-A');
insert into public.eos_action_approvals_v12
  (id, usuario_id, request_id, accion, requested_level, effective_level, expires_at, payload_snapshot)
values ('00000000-0000-4000-a000-0000000000d1', '00000000-0000-4000-a000-00000000000a',
        '00000000-0000-4000-a000-0000000000e1', 'REGISTRAR_VENTA', 2, 2, now() + interval '1 hour',
        '{"monto": 1500000}');

-- ------------------------------------------------------------
-- B, con su propia sesión, busca lo de A
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);

insert into resultado select 'B no ve la fila de usuario de A', count(*) = 0 from public.usuarios where id = '00000000-0000-4000-a000-00000000000a';
insert into resultado select 'B ve solo su propia fila de usuario', count(*) = 1 from public.usuarios;
insert into resultado select 'B no ve conversaciones de A', count(*) = 0 from public.conversaciones;
insert into resultado select 'B no ve mensajes de A', count(*) = 0 from public.mensajes;
insert into resultado select 'B no ve memorias de A', count(*) = 0 from public.memorias;
insert into resultado select 'B no ve objetivos de A', count(*) = 0 from public.objetivos;
insert into resultado select 'B no ve consumo de A', count(*) = 0 from public.uso_mensual;
insert into resultado select 'B no ve pagos de A', count(*) = 0 from public.solicitudes_pago;
insert into resultado select 'B no ve aprobaciones de A', count(*) = 0 from public.eos_action_approvals_v12;

update public.usuarios set nombre = 'hackeado' where id = '00000000-0000-4000-a000-00000000000a';
update public.mensajes set texto = 'hackeado' where usuario_id = '00000000-0000-4000-a000-00000000000a';
delete from public.memorias where usuario_id = '00000000-0000-4000-a000-00000000000a';

do $$
begin
  insert into public.mensajes (conversacion_id, usuario_id, rol, texto)
  values ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000a', 'usuario', 'inyectado por B');
  insert into resultado values ('B no puede escribir mensajes a nombre de A', false);
exception when insufficient_privilege or check_violation then
  insert into resultado values ('B no puede escribir mensajes a nombre de A', true);
end $$;

-- ------------------------------------------------------------
-- A, con su propia sesión: lo suyo lo ve; el plan no lo toca
-- ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);

insert into resultado select 'A ve sus mensajes', count(*) = 1 from public.mensajes;
insert into resultado select 'A ve sus pagos', count(*) = 1 from public.solicitudes_pago;

-- El upsert del registro (RegisterForm) sigue funcionando.
insert into public.usuarios (id, nombre, email, plan)
values ('00000000-0000-4000-a000-00000000000a', 'QA A', 'qa-a@aislamiento.test', 'free')
on conflict (id) do update set nombre = excluded.nombre, plan = excluded.plan;
insert into resultado select 'A puede editar su nombre', count(*) = 1 from public.usuarios where nombre = 'QA A';

update public.usuarios
set plan = 'enterprise', plan_vencimiento = '2099-01-01', estado_suscripcion = 'active',
    cancelar_al_vencimiento = false
where id = '00000000-0000-4000-a000-00000000000a';

do $$
begin
  update public.uso_mensual set mensajes_usados = 0;
  insert into resultado values ('A no puede poner su consumo en cero', false);
exception when insufficient_privilege then
  insert into resultado values ('A no puede poner su consumo en cero', true);
end $$;

do $$
begin
  update public.solicitudes_pago set estado = 'pagado';
  insert into resultado values ('A no puede marcar su pago como pagado', false);
exception when insufficient_privilege then
  insert into resultado values ('A no puede marcar su pago como pagado', true);
end $$;

do $$
begin
  update public.eos_action_approvals_v12 set payload_snapshot = '{"monto": 1}';
  insert into resultado values ('A no puede reescribir el payload de una aprobación', false);
exception when insufficient_privilege or raise_exception then
  insert into resultado values ('A no puede reescribir el payload de una aprobación', true);
end $$;

update public.eos_action_approvals_v12 set status = 'rejected'
where id = '00000000-0000-4000-a000-0000000000d1';

-- ------------------------------------------------------------
-- anon
-- ------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  perform count(*) from public.usuarios;
  insert into resultado values ('anon no puede leer usuarios', false);
exception when insufficient_privilege then
  insert into resultado values ('anon no puede leer usuarios', true);
end $$;
insert into resultado select 'anon lee el catálogo de planes (página de precios)', true from (select count(*) from public.planes) p;

-- ------------------------------------------------------------
-- Estado final, visto por el servidor
-- ------------------------------------------------------------
reset role;

insert into resultado
select 'El intento de A de darse un plan pago no cambió nada',
       plan = 'free' and plan_vencimiento is null
from public.usuarios where id = '00000000-0000-4000-a000-00000000000a';
insert into resultado
select 'B no pudo renombrar a A', nombre = 'QA A'
from public.usuarios where id = '00000000-0000-4000-a000-00000000000a';
insert into resultado select 'B no pudo editar mensajes de A', count(*) = 1
from public.mensajes where texto = 'Vendí Gs. 1.500.000 hoy';
insert into resultado select 'B no pudo borrar memorias de A', count(*) = 1
from public.memorias where usuario_id = '00000000-0000-4000-a000-00000000000a';
insert into resultado select 'A sí pudo rechazar su aprobación', status = 'rejected'
from public.eos_action_approvals_v12 where id = '00000000-0000-4000-a000-0000000000d1';

-- Y una red general: ninguna tabla de public queda sin RLS.
insert into resultado
select 'Toda tabla de public tiene RLS encendida', count(*) = 0
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

select prueba, ok from resultado;

rollback;
