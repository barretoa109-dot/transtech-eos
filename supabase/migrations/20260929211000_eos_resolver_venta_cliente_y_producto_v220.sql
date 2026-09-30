-- "Anulá la venta de Sheyla de la Paleta Makeup by Mario" no encontraba una
-- venta de hacía cuatro minutos.
--
-- ============================================================
-- QUÉ PASÓ (WhatsApp, 2026-09-29)
-- ============================================================
--
-- Sofía registró una venta a Sheyla de una "Paleta Makeup by Mario". Para
-- corregirla, EOS mandó ANULAR_VENTA con la referencia "Sheyla Paleta Makeup
-- by Mario" y la respuesta fue:
--
--   No encontré ninguna venta tuya de los últimos siete días que coincida
--   con "Sheyla Paleta Makeup by Mario".
--
-- `eos_erp_resolver_venta` pide que TODAS las palabras de la referencia estén
-- en los renglones (v176) O que todas estén en el nombre del cliente. Así es
-- como la gente nombra una venta: "la de Sheyla de la paleta". Mezcla las dos
-- cosas y no coincide con ninguna por separado.
--
-- Encima, la venta de reemplazo se registró igual y quedó duplicada. Eso lo
-- ataja el ejecutor (`lib/gateway/worker.ts`): sin anulación, no hay
-- reemplazo. Esto hace que la anulación encuentre la venta.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- Se agrega una tercera forma de coincidir: las palabras de la referencia
-- contra la UNIÓN de las palabras de los renglones y del nombre del cliente.
-- Las dos formas de antes quedan intactas, así que todo lo que coincidía
-- sigue coincidiendo. Tampoco cambia "la más reciente si hay varias" ni "si
-- dijo algo que no coincide, no cae a la última".
--
-- ============================================================
-- CÓMO SE APLICA
-- ============================================================
--
-- Como la v176: en su lugar, leyendo `pg_get_functiondef`. Si el texto
-- esperado no está, falla sin tocar nada; si ya está aplicada, avisa y sale.

do $v220$
declare
  v_oid oid;
  v_def text;
  v_nuevo text;
  v_marca constant text := 'v220: producto y cliente juntos';
begin
  v_oid := 'public.eos_erp_resolver_venta(uuid, text, integer)'::regprocedure;
  v_def := pg_get_functiondef(v_oid);

  -- La misma migración quedó también como 20260929192000_..._v218 (dos sesiones
  -- la renumeraron a la vez): cualquiera de las dos marcas cuenta como aplicada.
  if position('producto y cliente juntos' in v_def) > 0 then
    raise notice 'v220: eos_erp_resolver_venta ya estaba parchada.';
    return;
  end if;

  v_nuevo := regexp_replace(
    v_def,
    'exists\s*\(\s*select\s+1\s+from\s+public\.eos_crm_contactos\s+c\s+where\s+c\.id\s*=\s*v\.contacto_id\s+and\s+v_tokens\s*<@\s*public\.eos_tokens\(c\.nombre,\s*false\)\s*\)',
    '\&
        or /* v220: producto y cliente juntos */ v_tokens <@ (
          select coalesce(array_agg(distinct t.palabra), ''{}''::text[])
          from (
            select unnest(public.eos_tokens(coalesce(i.descripcion, ''''), true)) as palabra
            from public.eos_erp_venta_items i
            where i.venta_id = v.id
            union all
            select unnest(public.eos_tokens(c.nombre, false) || public.eos_tokens(c.nombre, true))
            from public.eos_crm_contactos c
            where c.id = v.contacto_id
          ) as t
        )'
  );

  if v_nuevo = v_def then
    raise exception 'v220: no encontré el bloque del cliente en eos_erp_resolver_venta; no se cambió nada.';
  end if;

  execute v_nuevo;
end;
$v220$;
