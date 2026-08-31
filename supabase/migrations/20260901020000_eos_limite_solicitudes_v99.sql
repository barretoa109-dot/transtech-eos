-- Un techo de solicitudes para lo que está expuesto sin sesión (v99).
--
-- ============================================================
-- QUÉ QUEDA ABIERTO HOY
-- ============================================================
--
-- `/api/ventas/contacto` no pide sesión, no pide nada, y manda un correo por
-- cada llamada. Su única defensa es un campo trampa invisible, que frena a un
-- bot de formulario y a nadie más.
--
-- Un `for` de tres líneas contra esa ruta hace dos cosas a la vez: quema la
-- cuota de Resend —y con ella los correos que sí importan, como el briefing
-- diario y los avisos de riesgo— e inunda ventas@transtech.com.py hasta que
-- nadie lo mire más. No hace falta ser nadie ni saber nada para lograrlo.
--
-- ============================================================
-- POR QUÉ EN LA BASE Y NO EN MEMORIA
-- ============================================================
--
-- La app corre en funciones sin estado: cada solicitud puede caer en una
-- instancia distinta, y un contador en memoria se reinicia solo. Un límite que
-- se olvida cada pocos minutos no es un límite.
--
-- La base es el único lugar compartido que ya existe. Cuesta un viaje más por
-- solicitud, y ese viaje solo lo pagan las rutas públicas.
--
-- ============================================================
-- NO SE GUARDA NINGUNA IP
-- ============================================================
--
-- Lo natural sería guardar la IP como clave. No se hace: una IP es un dato
-- personal, la página /privacidad no promete guardarlas, y una tabla con la IP
-- de cada visitante es exactamente el tipo de registro que después hay que
-- explicar.
--
-- La clave que llega acá ya viene hasheada con un secreto del servidor. Sirve
-- igual para contar —la misma IP da siempre la misma clave— y no sirve para
-- saber quién es: sin el secreto no se puede ir para atrás, y la tabla se borra
-- sola al día siguiente.

create table if not exists public.eos_limite_solicitudes (
  -- sha256(secreto + ruta + ip). Opaca a propósito.
  clave text primary key,
  ventana_desde timestamptz not null default now(),
  intentos integer not null default 0
);

comment on table public.eos_limite_solicitudes is
  'v99: contador por ventana para las rutas públicas. La clave viene hasheada con un secreto del servidor: no se puede saber de quién es.';

-- Nadie más que el servidor. Ni siquiera lectura: saber cuántos intentos lleva
-- una clave no le sirve a un usuario y sí a quien quiera tantear el límite.
alter table public.eos_limite_solicitudes enable row level security;
revoke all on table public.eos_limite_solicitudes from public, anon, authenticated;
grant all on table public.eos_limite_solicitudes to service_role;

-- ============================================================
-- Consumir un cupo
-- ============================================================
--
-- Todo en un solo `insert ... on conflict`, que es atómico. Con dos
-- sentencias —leer y después escribir— dos solicitudes simultáneas leerían el
-- mismo contador y pasarían las dos, que es justo lo que hace un atacante.

create or replace function public.eos_consumir_cupo_v99(
  p_clave text,
  p_ventana_segundos integer,
  p_maximo integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_intentos integer;
  v_desde timestamptz;
  v_ventana interval;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if coalesce(btrim(p_clave), '') = '' then
    raise exception 'EOS_LIMITE_CLAVE_REQUERIDA';
  end if;

  if p_ventana_segundos is null or p_ventana_segundos <= 0
     or p_maximo is null or p_maximo <= 0 then
    raise exception 'EOS_LIMITE_PARAMETROS_INVALIDOS';
  end if;

  v_ventana := make_interval(secs => p_ventana_segundos);

  insert into public.eos_limite_solicitudes as l (clave, ventana_desde, intentos)
  values (btrim(p_clave), now(), 1)
  on conflict (clave) do update set
    -- Si la ventana anterior ya venció, empieza una nueva. Si no, se suma.
    ventana_desde = case
      when now() - l.ventana_desde > v_ventana then now()
      else l.ventana_desde
    end,
    intentos = case
      when now() - l.ventana_desde > v_ventana then 1
      else l.intentos + 1
    end
  returning l.intentos, l.ventana_desde into v_intentos, v_desde;

  return jsonb_build_object(
    'permitido', v_intentos <= p_maximo,
    'intentos', v_intentos,
    'maximo', p_maximo,
    -- Cuántos segundos faltan para que se libere. Es lo que se le dice al
    -- cliente en `Retry-After`, para que no siga golpeando a ciegas.
    'faltan_segundos', greatest(
      0,
      ceil(extract(epoch from (v_desde + v_ventana - now())))::integer
    )
  );
end;
$$;

revoke all on function public.eos_consumir_cupo_v99(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.eos_consumir_cupo_v99(text, integer, integer) to service_role;

-- ============================================================
-- Que la tabla no crezca para siempre
-- ============================================================
--
-- Una fila por clave y por día. Sin limpieza, la tabla acumula una fila por
-- cada visitante que alguna vez tocó una ruta pública.
--
-- Se limpia sola desde el mismo cron del briefing, en vez de con `pg_cron`, que
-- este proyecto no usa. Borra lo que ya no puede afectar a ninguna ventana.

create or replace function public.eos_limpiar_limites_v99()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_borradas integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  delete from public.eos_limite_solicitudes
  where ventana_desde < now() - interval '1 day';

  get diagnostics v_borradas = row_count;

  return v_borradas;
end;
$$;

revoke all on function public.eos_limpiar_limites_v99() from public, anon, authenticated;
grant execute on function public.eos_limpiar_limites_v99() to service_role;
