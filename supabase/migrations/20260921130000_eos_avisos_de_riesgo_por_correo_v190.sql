-- Los avisos de riesgo llegan por correo salvo que la persona los apague.
--
-- ============================================================
-- QUÉ SE ENCONTRÓ
-- ============================================================
--
-- Medido el 2026-09-20: de 6 cuentas reales, solo 2 tenían el correo activado y 1
-- tenía push. Las otras cuatro no recibían ningún aviso proactivo (faltante de
-- plata, inventario bajo, cobros demorados), porque `canal_email` nace en `false`
-- y `entregarAviso` exigía que estuviera en `true`. El aviso no se perdía —la
-- pantalla de atención lo muestra— pero nadie se enteraba sin abrir la app.
--
-- ============================================================
-- POR QUÉ UNA COLUMNA NUEVA Y NO CAMBIAR `canal_email`
-- ============================================================
--
-- `canal_email` es también el permiso para el briefing DIARIO por correo y para
-- el seguimiento proactivo, y esos son opt-in a propósito: un correo diario que
-- nadie pidió es la forma más rápida de terminar en spam. Poner `canal_email` en
-- `true` para todos activaría eso también, que no es lo que se decidió.
--
-- Un aviso de riesgo es otra cosa: es que el 28 no le va a alcanzar la plata, o
-- que se está acabando un producto. Es transaccional, sale una vez por riesgo
-- (con su control de repetición) y afecta plata de la persona. Por eso tiene su
-- propio permiso, que arranca encendido y se apaga desde la pantalla de Briefing.
--
-- `not null default true`: una fila que ya existe queda en `true`, y quien no
-- tiene fila se trata como `true` en el código (no hace falta crearla). Los
-- permisos de la tabla son de tabla entera, así que la columna nueva ya queda
-- cubierta para que cada persona la edite sobre su propia fila.

alter table public.eos_followup_preferences
  add column if not exists avisos_riesgo_correo boolean not null default true;

comment on column public.eos_followup_preferences.avisos_riesgo_correo is
  'Si los avisos de riesgo (plata, inventario, cobros) pueden llegar por correo cuando no hay push. Arranca en true; la persona lo apaga. Independiente de canal_email, que es el opt-in del briefing diario.';
