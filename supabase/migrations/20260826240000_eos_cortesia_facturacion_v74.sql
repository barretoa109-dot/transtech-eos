-- EOS — completar la cortesía de las cuentas anteriores al plan armado
--
-- La v66 le regaló todos los módulos a las cuentas que ya existían, para que
-- nadie se quedara sin nada el día del despliegue. Pero corrió ANTES que la
-- v68, que es la que siembra `facturacion`: al aplicarlas se vio que esas
-- cuentas quedaron con once módulos y no con doce.
--
-- El efecto práctico no es cosmético. `exigirModulo` niega todo lo que está en
-- el catálogo y no se contrató, así que esas cuentas verían la pestaña de
-- facturación pidiéndoles contratar un módulo que vale cero.
--
-- ============================================================
-- POR QUÉ SOLO A QUIEN YA TENÍA CORTESÍA
-- ============================================================
--
-- Repetir el `cross join` de la v66 sobre `auth.users` sería más simple, pero a
-- partir de ahora hay gente que CONTRATA módulos: regalarle a todos todo lo que
-- falte convertiría cada migración nueva en una amnistía. Esto alcanza solo a
-- quien ya tiene una fila marcada `cortesia`, que es exactamente la población
-- que la v66 quiso cubrir.

insert into public.eos_usuario_modulos (usuario_id, modulo_codigo, estado, origen, notas)
select distinct um.usuario_id, 'facturacion', 'activo', 'cortesia',
       'Completa la cortesía de la v66, que corrió antes de que existiera el módulo'
from public.eos_usuario_modulos um
where um.origen = 'cortesia'
  and exists (select 1 from public.eos_modulos m where m.codigo = 'facturacion')
on conflict (usuario_id, modulo_codigo) do nothing;
