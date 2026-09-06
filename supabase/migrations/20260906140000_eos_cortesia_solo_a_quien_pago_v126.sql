-- La cortesía era para no apagarle EOS a quien pagaba, y se la dio a todos.
--
-- ============================================================
-- QUÉ PASÓ
-- ============================================================
--
-- La v66 cambió el producto: se dejaron de vender planes con funciones adentro
-- y se pasó a módulos que cada uno contrata sueltos. Las cuentas que ya
-- existían nunca habían contratado ninguno, así que abrirían EOS y no
-- tendrían nada. Para evitarlo, la sección 8 de aquella migración hizo esto:
--
--   insert into public.eos_usuario_modulos (...)
--   select u.id, m.codigo, 'activo', 'cortesia', ...
--   from auth.users u
--   cross join public.eos_modulos m
--   where m.activo = true;
--
-- Un `cross join` contra `auth.users` entero. La intención era proteger a
-- quien estaba pagando; el efecto fue regalarle **los doce módulos, sin
-- vencimiento, para siempre** a toda cuenta que existiera ese día — incluidas
-- las del plan gratuito.
--
-- Por eso hoy el plan free tiene todas las funciones de un plan completo. No
-- es que los permisos estén mal configurados: es que hay filas de regalo que
-- no debieron existir. Se ve desde el uso real y es lo que reportó el usuario.
--
-- Del otro lado del mismo error: las cuentas creadas DESPUÉS del 26 de agosto
-- no reciben ningún módulo. Entonces el producto tiene hoy dos "planes
-- gratuitos" distintos según el día en que alguien se registró, y ninguno de
-- los dos es el que se pensó vender.
--
-- ============================================================
-- QUÉ SE HACE, Y POR QUÉ ASÍ
-- ============================================================
--
-- Se conserva la cortesía exactamente donde cumplía su propósito y se saca
-- donde nunca lo tuvo:
--
--   * SE QUEDA en las cuentas con un plan pago (personal, pro, business,
--     enterprise). Esas son las que la migración quería proteger: compraron un
--     plan que prometía panel, briefing y documentos, y quitárselo ahora sería
--     cobrarles por algo y después apagarlo.
--
--     Se mira el CÓDIGO del plan y no si está vigente. Una suscripción vencida
--     ya tiene su castigo —vuelve al cupo gratuito de mensajes, v125— y sumarle
--     la pérdida de los módulos convertiría un mes sin pagar en una mudanza de
--     producto. Cuando renueve, todo sigue donde estaba.
--
--   * SE VA de las cuentas del plan gratuito. Nunca pagaron nada, así que no
--     hay nada que proteger: lo que hay es el producto entero regalado.
--
--   * SE QUEDA en las cuentas de demostración, nombradas una por una más
--     abajo. Una demo que no puede mostrar el producto no sirve para nada, y
--     dejar la excepción escrita con nombre y apellido es lo que evita que
--     dentro de seis meses alguien mire una cuenta free con todo prendido y no
--     sepa si es un privilegio decidido o el mismo bug otra vez.
--
-- Los módulos comprados (`origen = 'pago'`) no se tocan en ningún caso: esta
-- migración solo mira las filas de regalo.
--
-- ============================================================
-- LO QUE ESTO NO RESUELVE
-- ============================================================
--
-- Sigue sin haber una definición de qué incluye el plan gratuito. Después de
-- esto, "free" es: conversar con EOS, cinco mensajes por día, y ningún módulo.
-- Es una definición coherente y es la que queda vigente, pero es la que quedó,
-- no una que alguien haya diseñado. Decidir si el panel financiero —o algún
-- otro— tiene que venir de arranque para que la cuenta gratuita sirva de algo
-- es una decisión de producto y no de esta migración.

-- ============================================================
-- 1) A quién se le saca
-- ============================================================

create temporary table cortesia_a_retirar on commit drop as
select um.id, um.usuario_id, um.modulo_codigo, u.email
from public.eos_usuario_modulos um
join public.usuarios u on u.id = um.usuario_id
where um.origen = 'cortesia'
  and lower(coalesce(u.plan, 'free')) = 'free'
  -- Las cuentas de demostración, nombradas a propósito.
  and lower(coalesce(u.email, '')) not in ('demo@transtech.com.py');

do $$
declare
  v_filas integer;
  v_cuentas integer;
begin
  select count(*), count(distinct usuario_id) into v_filas, v_cuentas from cortesia_a_retirar;
  raise notice 'v126: se retiran % módulos de cortesía en % cuenta(s) del plan gratuito.', v_filas, v_cuentas;
end;
$$;

delete from public.eos_usuario_modulos um
using cortesia_a_retirar r
where um.id = r.id;

-- ============================================================
-- 2) Que el mismo cross join no se repita
-- ============================================================
--
-- La v66 corrió una vez y no vuelve a correr, pero la próxima migración que
-- quiera "que a nadie se le apague" va a copiar ese bloque: es el que está
-- escrito y es el que funcionó. Queda dicho en el comment de la columna,
-- que es donde lo va a leer quien escriba la próxima.

comment on column public.eos_usuario_modulos.origen is
  'De dónde salió el acceso: pago (lo compró), cortesia (se le regaló), manual. Una cortesía masiva SIEMPRE se acota por plan: la v66 la dio con un cross join contra auth.users entero y le regaló el producto completo al plan gratuito. Ver v126.';
