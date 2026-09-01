-- ============================================================
-- v101 · El nivel de autonomía deja de ser una constante del código
-- ============================================================
--
-- QUÉ PASABA
--
-- Una clienta le pedía a EOS por chat que anotara una venta. EOS respondía
-- "Operación lista para registrar" y no quedaba nada: ni la venta, ni una
-- aprobación pendiente que ella pudiera confirmar. La pantalla de aprobaciones
-- aparecía vacía. Lo reportó el 31 de agosto de 2026.
--
-- POR QUÉ
--
-- El gate decide qué hacer con una acción según el nivel de autonomía del
-- usuario: 0 recomendar, 1 preparar, 2 pedir aprobación, 3 ejecutar solo.
-- Ese nivel sale de `eos_autonomy_profiles_v12`, y cuando el usuario no tiene
-- fila ahí el código usa un valor por defecto propio.
--
-- De los seis usuarios de producción, UNO solo tenía fila. Los otros cinco
-- corrían con el valor por defecto, y ese valor terminó siendo 1: preparar.
-- Nivel 1 no ejecuta y tampoco pide permiso — la acción se prepara y se
-- descarta. Para el usuario es indistinguible de que el sistema esté roto,
-- salvo que además el chat le dice que salió bien.
--
-- La evidencia está en `eos_autonomy_events_v12`: todas las evaluaciones de
-- los últimos catorce días registran `configured_level: 1` y `decision:
-- "prepare"`, y la última aprobación creada es del 20 de agosto.
--
-- QUÉ SE ARREGLA ACÁ
--
--   1. El default de la columna pasa de 1 a 2. Que la base y el código digan
--      lo mismo, para que no vuelva a haber dos respuestas a la pregunta
--      "¿qué nivel tiene este usuario?".
--
--   2. Cada usuario que existe hoy tiene su fila, con nivel 2. El nivel deja
--      de ser un valor implícito de un `const` y pasa a ser un dato que se
--      puede leer, auditar y cambiar por usuario.
--
-- Nivel 2 es "pedir aprobación": EOS prepara la acción y la deja esperando
-- que la persona la confirme en su pantalla. Nunca ejecuta sola. Es más
-- seguro que el 3 y es el primero que sirve para algo: el 1 no ejecuta ni
-- pregunta, y una acción que no ejecuta ni pregunta simplemente se pierde.
--
-- No se toca al usuario que ya tenía fila: su configuración es suya.

alter table public.eos_autonomy_profiles_v12
  alter column default_level set default 2;

comment on column public.eos_autonomy_profiles_v12.default_level is
  '0=recomendar, 1=preparar (ni ejecuta ni pregunta), 2=pedir aprobación, 3=autoejecutar cuando el riesgo y los límites lo permitan. El default es 2: es el primer nivel en el que una acción llega a alguna parte.';

insert into public.eos_autonomy_profiles_v12 (usuario_id, default_level)
select u.id, 2
from auth.users u
where not exists (
  select 1
  from public.eos_autonomy_profiles_v12 p
  where p.usuario_id = u.id
);
