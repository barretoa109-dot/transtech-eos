-- v231: la venta que se registra por el chat guarda lo que la persona dijo de
-- ella ("sobrepedido", "seña", "para regalo"), no siempre la misma frase.
--
-- ============================================================
-- QUÉ PASÓ (01/10/2026, WhatsApp, cuenta real)
-- ============================================================
--
-- "Vendí a 160.000gs. Era un sobrepedido de Gladys Velilla." La venta se
-- registró con producto, clienta y monto, pero "sobrepedido" se perdió: el
-- ejecutor escribe siempre 'Cargada por EOS desde la conversación.' en
-- `eos_erp_ventas.notas`, y REGISTRAR_VENTA no tenía dónde llevarlo. Para esta
-- clienta "sobrepedido" separa lo que trae por encargo de lo que tiene en
-- stock: es un dato de la venta, no un comentario.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- REGISTRAR_VENTA acepta `nota` (opcional). Si viene, va a `notas`, recortada a
-- 500 caracteres; si no, la frase de siempre. Nada más cambia: ni el precio,
-- ni el costo, ni el stock, ni el contacto.
--
-- En su lugar, desde `pg_get_functiondef`, con un ancla que aparece una sola
-- vez (como la v224): la función tiene cientos de líneas y otras sesiones la
-- parchean. Idempotente. Rollback: volver a poner la frase fija en el mismo
-- lugar.

do $v231$
declare
  v_oid oid;
  v_def text;
  v_ancla constant text := $a$'Cargada por EOS desde la conversación.',$a$;
  v_veces integer;
begin
  v_oid := 'public.eos_execute_internal_effect_v64(uuid)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  if position($m$v_data ->> 'nota'$m$ in v_def) > 0 then
    raise notice 'v231: la venta ya lleva la nota; no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'v231: el ancla aparece % veces, no 1. No se cambió nada.', v_veces;
  end if;

  execute replace(v_def, v_ancla, $n$-- v231: lo que la persona dijo de la venta ("sobrepedido").
        coalesce(
          nullif(left(btrim(v_data ->> 'nota'), 500), ''),
          'Cargada por EOS desde la conversación.'
        ),$n$);
end;
$v231$;
