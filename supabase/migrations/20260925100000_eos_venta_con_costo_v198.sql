-- El costo que EOS ya sabe entra con la venta, y el que llega después
-- completa el margen de las ventas que lo esperaban (v198).
--
-- ============================================================
-- LO QUE PASÓ, CON FECHA
-- ============================================================
--
-- El 25 de septiembre de 2026 Sofía le dictó a EOS una venta de dos productos.
-- EOS le contestó con el margen bruto de cada uno, costo incluido:
--
--   Zapatos Mary Jane: venta ₲180.000, costo ₲146.473,876, margen 18,63%
--   Maija pantalones:  venta ₲128.000, costo ₲116.382,076, margen 9,08%
--
-- y en el mismo mensaje, abajo: "De 2 de esos productos no sé el costo, así
-- que sus márgenes quedan pendientes: pasámelos y los completo". Ella le
-- preguntó por qué decía que no tenía el costo si se lo acababa de escribir.
-- No es la primera vez (ver la v156 y el 24/09 en `lib/eos/respuesta-visible.ts`).
--
-- El modelo no se confundió: entendió el costo y lo usó. Lo que no tenía era
-- DÓNDE ponerlo. Dos huecos, los dos de esta migración:
--
--   1. REGISTRAR_VENTA no tenía campo de costo. Los ítems llevaban producto,
--      cantidad y precio; el producto nuevo nacía sin costo, la línea de la
--      venta congelaba ese NULL (v100) y la frase del worker decía, con
--      razón desde la base, "no sé el costo". El costo que el modelo acababa
--      de usar se quedaba en el texto de la respuesta.
--
--   2. Y aunque la persona lo mandara después —o el modelo pidiera un
--      ACTUALIZAR_PRODUCTO en la misma respuesta, que es lo que arregló el
--      #115—, el costo llegaba al PRODUCTO pero no a la venta ya hecha: su
--      línea seguía en NULL para siempre. "Pasámelos y los completo" era una
--      promesa que el sistema no cumplía: el panel de rentabilidad seguía sin
--      el margen de esa venta.
--
-- ============================================================
-- 1) LA VENTA ACEPTA EL COSTO DE CADA ÍTEM
-- ============================================================
--
-- `items[].costo_unitario` (o `costo`). Si el producto no tiene costo, se le
-- pone ANTES de registrar la venta, así la línea nace con él (el trigger de la
-- v100 lo copia del producto) y la venta ya tiene margen.
--
-- Nunca pisa un costo cargado: el que ya está en el catálogo es el que la
-- persona puso a propósito, y cambiarlo es ACTUALIZAR_PRODUCTO. Es la misma
-- regla de la v156: completar un costo que falta no es editar.
--
-- El número se lee con cuidado, porque justo en este caso vino con decimales:
--
--   · un número de JSON se toma tal cual. Pasarlo por `eos_leer_monto`
--     convertiría 146473.876 en 146.473.876 —tres dígitos después del punto
--     son miles para esa función—, mil veces más.
--   · un texto sí pasa por `eos_leer_monto` ("146.473" es ciento cuarenta y
--     seis mil).
--   · se redondea a dos decimales, que es lo que guarda la columna.
--   · un costo de más de diez veces el precio de venta se descarta y el
--     margen queda pendiente, como antes. Es la forma que tiene un separador
--     leído al revés, y un margen de -99.900% en el panel es peor que uno que
--     se pide.
--
-- ============================================================
-- 2) EL PRIMER COSTO DE UN PRODUCTO COMPLETA SUS VENTAS PENDIENTES
-- ============================================================
--
-- Cuando un producto pasa de NO tener costo a tenerlo —por el chat, por la
-- pantalla, por una compra— las líneas de venta de ese producto que quedaron
-- en NULL toman ese costo. Solo las NULL: una línea con costo lo congeló a
-- propósito (v100) y no se toca.
--
-- Es un trigger y no un cambio en cada camino porque son varios (v133, v131,
-- las compras, la pantalla) y cualquiera que se olvide vuelve a dejar el
-- margen pendiente sin avisar.
--
-- `costo_estimado` queda en false: NULL significaba "no había costo
-- verificable", y este es el primero que la persona declaró para ese
-- producto. Marcarlo "estimado" le mostraría una duda sobre el número que ella
-- misma acaba de dar.

-- ============================================================
-- 1) Poner el costo que vino con la venta
-- ============================================================

create or replace function public.eos_venta_poner_costo_v198(
  p_usuario_id uuid,
  p_producto_id uuid,
  p_item jsonb
)
returns numeric
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_valor jsonb;
  v_costo numeric;
  v_precio numeric;
begin
  if p_producto_id is null or p_item is null or jsonb_typeof(p_item) <> 'object' then
    return null;
  end if;

  v_valor := coalesce(p_item -> 'costo_unitario', p_item -> 'costo');

  if v_valor is null or jsonb_typeof(v_valor) = 'null' then
    return null;
  end if;

  -- Un número de JSON se toma tal cual. Ver la cabecera, sección 1.
  if jsonb_typeof(v_valor) = 'number' then
    v_costo := (v_valor #>> '{}')::numeric;
  else
    v_costo := public.eos_leer_monto(v_valor #>> '{}');
  end if;

  -- Cero no es un costo que alguien dicte: es el modelo rellenando el campo.
  if v_costo is null or v_costo <= 0 then
    return null;
  end if;

  v_costo := round(v_costo, 2);

  select p.precio_venta into v_precio
  from public.eos_erp_productos p
  where p.id = p_producto_id
    and p.usuario_id = p_usuario_id;

  -- Diez veces el precio es un separador leído al revés, no un costo.
  if v_precio is not null and v_precio > 0 and v_costo > v_precio * 10 then
    return null;
  end if;

  -- Solo si no tenía. Sin fila actualizada, `into` deja v_costo en NULL.
  update public.eos_erp_productos
  set costo = v_costo,
      actualizado_en = now()
  where id = p_producto_id
    and usuario_id = p_usuario_id
    and costo is null
  returning costo into v_costo;

  return v_costo;
end;
$function$;

revoke all on function public.eos_venta_poner_costo_v198(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.eos_venta_poner_costo_v198(uuid, uuid, jsonb)
  to service_role;

comment on function public.eos_venta_poner_costo_v198(uuid, uuid, jsonb) is
  'v198: si el ítem de una venta del chat trae costo y el producto no tiene, se lo pone antes de registrar la venta. Nunca pisa un costo cargado. Devuelve el costo puesto o NULL.';

-- ============================================================
-- 2) El primer costo completa las ventas que lo esperaban
-- ============================================================

create or replace function public.eos_erp_completar_margenes_v198()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.eos_erp_venta_items vi
  set costo_unitario = new.costo,
      costo_estimado = false
  from public.eos_erp_ventas v
  where vi.venta_id = v.id
    and v.usuario_id = new.usuario_id
    and vi.producto_id = new.id
    and vi.costo_unitario is null;

  return null;
end;
$function$;

revoke all on function public.eos_erp_completar_margenes_v198()
  from public, anon, authenticated;

drop trigger if exists eos_erp_producto_completa_margenes_v198 on public.eos_erp_productos;
create trigger eos_erp_producto_completa_margenes_v198
  after update of costo on public.eos_erp_productos
  for each row
  when (old.costo is null and new.costo is not null)
  execute function public.eos_erp_completar_margenes_v198();

comment on function public.eos_erp_completar_margenes_v198() is
  'v198: cuando un producto recibe su primer costo, las líneas de venta de ese producto que quedaron sin costo lo toman. Las que ya tenían costo no se tocan (v100).';

-- Las que ya quedaron pendientes con un producto que HOY tiene costo: el caso
-- de Sofía si ya mandó el costo, y el de la Campera del 24/09.
update public.eos_erp_venta_items vi
set costo_unitario = p.costo,
    costo_estimado = false
from public.eos_erp_productos p, public.eos_erp_ventas v
where vi.producto_id = p.id
  and vi.venta_id = v.id
  and v.usuario_id = p.usuario_id
  and vi.costo_unitario is null
  and p.costo is not null
  and v.creado_en >= timestamp with time zone '2026-09-01 00:00:00-03';

-- ============================================================
-- 3) El ejecutor lee el costo de cada ítem de la venta
-- ============================================================
--
-- En su lugar desde `pg_get_functiondef`, como la v150 y la v191: la función
-- tiene más de mil líneas y transcribirla para cambiar tres es cómo se pierde
-- una rama sin que nadie lo note.
--
-- Tres anclas, cada una tiene que aparecer una sola vez:
--
--   · la declaración de `v_sin_costo`: se suma `v_costos_venta`.
--   · la condición que anota un producto sin costo: antes de anotarlo, se
--     intenta ponerle el costo que vino en el ítem. Si se pudo, va a
--     `costos_puestos`; si no, a `sin_costo` como siempre.
--   · el resultado: se devuelve `costos_puestos` para que la respuesta diga
--     qué costo quedó.

do $parche$
declare
  v_oid oid;
  v_def text;
  v_nueva text;
  v_ancla text;
  v_veces integer;
  v_anclas constant text[] := array[
    $a$v_sin_costo jsonb := '[]'::jsonb;$a$,
    $a$if coalesce((v_alta ->> 'costo_pendiente')::boolean, false) then$a$,
    $a$'sin_costo', v_sin_costo,$a$
  ];
begin
  select p.oid into v_oid
  from pg_proc p
  where p.proname = 'eos_execute_internal_effect_v64'
    and p.pronamespace = 'public'::regnamespace;

  if v_oid is null then
    raise exception 'v198: no existe eos_execute_internal_effect_v64';
  end if;

  v_def := pg_get_functiondef(v_oid);

  -- Idempotente.
  if position('eos_venta_poner_costo_v198' in v_def) > 0 then
    raise notice 'v198: el ejecutor ya lee el costo de la venta; no se toca.';
    return;
  end if;

  foreach v_ancla in array v_anclas loop
    v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);

    if v_veces <> 1 then
      raise exception 'v198: el ancla "%" aparece % veces, no 1. No se cambió nada.', v_ancla, v_veces;
    end if;
  end loop;

  v_nueva := replace(v_def, v_anclas[1],
    v_anclas[1] || $n$
  v_costos_venta jsonb := '[]'::jsonb;$n$);

  v_nueva := replace(v_nueva, v_anclas[2],
    $n$if coalesce((v_alta ->> 'costo_pendiente')::boolean, false)
           and public.eos_venta_poner_costo_v198(v_command.usuario_id, v_producto_id, v_item) is not null then
          -- El costo vino con la venta (v198): la línea nace con margen.
          v_costos_venta := v_costos_venta || jsonb_build_array(
            jsonb_build_object(
              'nombre', v_alta ->> 'nombre',
              'costo', (select p.costo from public.eos_erp_productos p where p.id = v_producto_id)
            )
          );
        elsif coalesce((v_alta ->> 'costo_pendiente')::boolean, false) then$n$);

  v_nueva := replace(v_nueva, v_anclas[3],
    v_anclas[3] || $n$
             'costos_puestos', v_costos_venta,$n$);

  execute v_nueva;

  raise notice 'v198: la rama REGISTRAR_VENTA del ejecutor pone el costo que vino en cada ítem.';
end;
$parche$;
