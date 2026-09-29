-- v215: una venta a un cliente que todavía no está agendado se registra igual.
--
-- La falla más frecuente del circuito en cuentas reales (29/09/2026, tablero
-- de los viernes): 3 de los 4 errores de la semana fueron ventas perdidas
-- porque el cliente no estaba en los contactos ("Sheyla", "Gladys Velilla",
-- "Pali Yegros"). EOS contestaba "pedime que lo agende primero" y la venta no
-- quedaba en ningún lado. Es el mismo error que la v156 arregló con los
-- productos: el dato que falta se crea en el camino, no frena la venta.
--
-- Ahora, en la rama REGISTRAR_VENTA del ejecutor:
--
--   · Si el nombre coincide con un contacto (eos_crm_resolver_contacto), como
--     siempre.
--   · Si NO se parece a ninguno (ninguna palabra en común), se agenda como
--     cliente y la venta sigue. El resultado lleva `contacto_creado` para que
--     la respuesta lo diga.
--   · Si se parece a uno o más pero no alcanza para decidir ("Gladys Velilla"
--     con "Gladys" agendada, o dos Rossanas), NO se adivina: falla con
--     EOS_ACCION_CONTACTO_AMBIGUO y EOS pregunta cuál. Crear un duplicado de
--     un cliente que ya debe plata le parte la cuenta en dos.
--
-- Solo ventas. Un cobro o una oportunidad siguen exigiendo que el contacto
-- exista: cobrarle a alguien que no se conoce no tiene sentido.
--
-- En su lugar desde `pg_get_functiondef`, como la v198: el ejecutor tiene más
-- de mil líneas y otras sesiones lo tocan. Un ancla, que tiene que aparecer una
-- sola vez. Idempotente.

do $parche$
declare
  v_oid oid;
  v_def text;
  v_nueva text;
  v_ancla constant text := $a$raise exception 'EOS_ACCION_CONTACTO_NO_RESUELTO: %', v_texto;$a$;
  v_veces integer;
begin
  select p.oid into v_oid
  from pg_proc p
  where p.proname = 'eos_execute_internal_effect_v64'
    and p.pronamespace = 'public'::regnamespace;

  if v_oid is null then
    raise exception 'v215: no existe eos_execute_internal_effect_v64';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('EOS_ACCION_CONTACTO_AMBIGUO' in v_def) > 0 then
    raise notice 'v215: el ejecutor ya agenda al cliente nuevo de una venta; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v215: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  v_nueva := replace(v_def, v_ancla, $n$-- v215: si se parece a alguien, se pregunta; si es nuevo, se agenda.
          if exists (
            select 1
            from public.eos_crm_contactos c
            where c.usuario_id = v_command.usuario_id
              and c.activo
              and public.eos_tokens(c.nombre, false) && public.eos_tokens(v_texto, false)
          ) then
            raise exception 'EOS_ACCION_CONTACTO_AMBIGUO: %', v_texto;
          end if;

          insert into public.eos_crm_contactos (usuario_id, tipo, nombre, es_cliente, es_proveedor)
          values (v_command.usuario_id, 'persona', left(v_texto, 160), true, false)
          returning id into v_contacto_id;

          v_result := coalesce(v_result, '{}'::jsonb)
            || jsonb_build_object('contacto_creado', left(v_texto, 160));$n$);

  execute v_nueva;

  raise notice 'v215: una venta a un cliente nuevo lo agenda y se registra igual.';
end;
$parche$;
