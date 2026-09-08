-- "Devolución — Devolución de camisa".
--
-- Salió así en la primera prueba real: la función antepone "Devolución — " y
-- el modelo ya había escrito "Devolución de camisa" en la descripción. El
-- prefijo existe para que la fila se entienda sola en la lista de movimientos,
-- pero puesto sin mirar se lee como un error del sistema — y en una pantalla de
-- plata, algo que se lee como un error hace dudar del resto de los números.
--
-- Se agrega solo cuando la descripción no lo dice ya.

create or replace function public.eos_finanzas_registrar_personal_v136(
  p_usuario_id uuid,
  p_command_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_lista jsonb;
  v_tipo text;
  v_pedido text;
  v_monto numeric;
  v_descripcion text;
  v_fecha date;
  v_moneda text;
  v_id uuid;
  v_primero uuid;
  v_hechos jsonb := '[]'::jsonb;
  v_cuantos integer := 0;
  v_entra numeric := 0;
  v_sale numeric := 0;
  v_vuelve numeric := 0;
begin
  v_lista := case
    when jsonb_typeof(p_datos -> 'movimientos') = 'array' then p_datos -> 'movimientos'
    when jsonb_typeof(p_datos -> 'items') = 'array' then p_datos -> 'items'
    else jsonb_build_array(p_datos)
  end;

  if jsonb_array_length(v_lista) = 0 then
    raise exception 'EOS_ACCION_PERSONAL_SIN_DATOS';
  end if;

  for v_item in select * from jsonb_array_elements(v_lista)
  loop
    v_cuantos := v_cuantos + 1;
    if v_cuantos > 15 then
      raise exception 'EOS_ACCION_PERSONAL_DEMASIADOS';
    end if;

    v_descripcion := nullif(btrim(coalesce(
      v_item ->> 'descripcion', v_item ->> 'concepto', v_item ->> 'detalle', ''
    )), '');

    if v_descripcion is null then
      raise exception 'EOS_ACCION_PERSONAL_SIN_DESCRIPCION';
    end if;

    v_monto := nullif(regexp_replace(coalesce(
      v_item ->> 'monto', v_item ->> 'importe', v_item ->> 'total', ''
    ), '[^0-9.]', '', 'g'), '')::numeric;

    if v_monto is null or v_monto <= 0 then
      raise exception 'EOS_ACCION_PERSONAL_SIN_MONTO: %', v_descripcion;
    end if;

    -- El tipo no se adivina de la descripción. "Cobré" e "invertí" se parecen
    -- lo suficiente como para que una heurística acá se equivoque de signo, y
    -- un gasto contado como ingreso mueve el disponible real al doble en la
    -- dirección equivocada.
    v_pedido := lower(coalesce(v_item ->> 'tipo', ''));

    v_tipo := case
      when v_pedido = 'ingreso' then 'ingreso'
      -- Devolución, reembolso, reintegro: la plata había salido y volvió. Se
      -- guarda como gasto NEGATIVO para que reste del gasto de su categoría en
      -- vez de inflar los ingresos del mes.
      when v_pedido in ('devolucion', 'devolución', 'reembolso', 'reintegro') then 'devolucion'
      else 'gasto'
    end;

    v_fecha := case
      when coalesce(v_item ->> 'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item ->> 'fecha')::date
      else (now() at time zone 'America/Asuncion')::date
    end;

    v_moneda := upper(nullif(btrim(coalesce(v_item ->> 'moneda', '')), ''));
    if v_moneda is null or length(v_moneda) <> 3 then v_moneda := 'PYG'; end if;

    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, fecha, origen, ambito,
      action_command_id, metadata
    ) values (
      p_usuario_id,
      case when v_tipo = 'ingreso' then 'ingreso' else 'gasto' end,
      case when v_tipo = 'devolucion' then -v_monto else v_monto end,
      v_moneda,
      -- El prefijo solo si no lo dijo ya el modelo: "Devolución — Devolución
      -- de camisa" es lo que sale de agregarlo sin mirar, y se lee como un
      -- error del sistema.
      left(case
        when v_tipo = 'devolucion' and lower(v_descripcion) not like '%devoluci%'
          and lower(v_descripcion) not like '%reembols%'
          and lower(v_descripcion) not like '%reintegr%'
        then 'Devolución — ' || v_descripcion
        else v_descripcion
      end, 300),
      v_fecha,
      'chat', 'personal', p_command_id,
      jsonb_build_object('fuente', 'worker_gate', 'action_command_id', p_command_id)
        || case when v_tipo = 'devolucion' then jsonb_build_object('devolucion', true) else '{}'::jsonb end
    )
    returning id into v_id;

    if v_primero is null then v_primero := v_id; end if;

    if v_tipo = 'ingreso' then v_entra := v_entra + v_monto;
    elsif v_tipo = 'devolucion' then v_vuelve := v_vuelve + v_monto;
    else v_sale := v_sale + v_monto;
    end if;

    v_hechos := v_hechos || jsonb_build_object(
      'id', v_id,
      'tipo', v_tipo,
      'monto', v_monto,
      'moneda', v_moneda,
      'descripcion', v_descripcion,
      'fecha', v_fecha
    );
  end loop;

  return jsonb_build_object(
    'primero', v_primero,
    'movimientos', v_hechos,
    'entro', v_entra,
    'salio', v_sale,
    'volvio', v_vuelve
  );
end;
$function$;

comment on function public.eos_finanzas_registrar_personal_v136(uuid, uuid, jsonb) is
  'v142: como la v141, y sin repetir la palabra devolución cuando el modelo ya la escribió.';
