-- EOS Finanzas — avisos que el parser vio pero no se animó a guardar solo
--
-- Hasta acá, un correo del banco que `extraerDeCorreo` leyó con confianza
-- menor al umbral (0.8) quedaba SOLO en la bitácora de auditoría: el usuario
-- nunca lo veía salvo que fuera a buscarlo. Eso rompe el principio 1 de la
-- doctrina ("cero carga manual") en el peor sentido posible — un movimiento
-- real que EOS detectó pero no mostró, y que el usuario termina sin saber que
-- existió, en vez de poder confirmarlo con un toque.
--
-- Esto no es categorización (eso ya se resuelve con `eos_reglas_categoria`,
-- v234): es la ingesta misma, Fase 1 del roadmap de tecnología — cerrar el
-- loop de lo que el parser casi se pierde.

-- ============================================================
-- 1) Qué vio el parser, guardado en la misma fila del correo.
--
--    No hace falta una tabla nueva: `eos_correos_entrantes` ya tiene una fila
--    por correo procesado, con RLS de lectura para el dueño. Guardar ahí lo
--    que se descartó evita duplicar la relación con el usuario y el email_id.
-- ============================================================
alter table public.eos_correos_entrantes
  add column if not exists tipo text check (tipo in ('ingreso', 'gasto')),
  add column if not exists monto numeric,
  add column if not exists moneda text check (moneda in ('PYG', 'USD')),
  add column if not exists descripcion text,
  add column if not exists confianza numeric,
  -- El usuario ya lo resolvió (lo agregó o dijo "no era nada"). Sin esto la
  -- lista de pendientes crecería para siempre con avisos ya atendidos.
  add column if not exists revisado boolean not null default true;

comment on column public.eos_correos_entrantes.revisado is
  'false solo mientras hay un movimiento descartado por baja confianza esperando que el usuario lo confirme o lo descarte.';

do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'eos_correos_entrantes'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%estado%'
  loop
    execute format('alter table public.eos_correos_entrantes drop constraint %I', v_nombre);
  end loop;
end;
$$;

alter table public.eos_correos_entrantes
  add constraint eos_correos_entrantes_estado_check
  check (estado in ('procesado', 'sin_movimientos', 'error', 'descartado'));

-- Pendientes de revisión: el único índice que importa para esta pantalla.
create index if not exists eos_correos_descartados_pendientes_idx
  on public.eos_correos_entrantes (usuario_id, recibido_en desc)
  where estado = 'descartado' and revisado = false;

-- ============================================================
-- 2) Resolver un aviso descartado.
--
--    SECURITY DEFINER porque el UPDATE de `eos_correos_entrantes` no tiene
--    policy de escritura para `authenticated` (el webhook escribe con
--    service_role; dejar que el usuario actualice la fila directo abriría la
--    puerta a que edite remitente o estado de cualquier correo suyo, no solo
--    a resolver el que se le muestra). La función es el único camino, y el
--    único efecto posible es: confirmar (crea el movimiento con los datos
--    que YA se habían leído, sin volver a interpretar texto) o descartar
--    (solo marca revisado).
-- ============================================================
create or replace function public.eos_finanzas_resolver_correo_v250(
  p_email_id text,
  p_accion text -- 'confirmar' | 'descartar'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_fila public.eos_correos_entrantes%rowtype;
  v_movimiento_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  if p_accion not in ('confirmar', 'descartar') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  select * into v_fila
    from public.eos_correos_entrantes
   where email_id = p_email_id
     and usuario_id = v_usuario
     and estado = 'descartado'
     and revisado = false
   for update;

  if not found then
    -- Ya resuelto (otra pestaña, doble toque) o no es suyo: no es un error,
    -- no hay nada que hacer.
    return null;
  end if;

  if p_accion = 'confirmar' then
    insert into public.eos_movimientos_financieros (
      usuario_id, tipo, monto, moneda, descripcion, fecha, origen, metadata
    ) values (
      v_usuario,
      v_fila.tipo,
      v_fila.monto,
      v_fila.moneda,
      coalesce(v_fila.descripcion, 'Movimiento confirmado desde un aviso del banco'),
      v_fila.recibido_en::date,
      'correo',
      jsonb_build_object(
        'email_id', v_fila.email_id,
        'confianza', v_fila.confianza,
        'confirmado_manualmente', true
      )
    )
    returning id into v_movimiento_id;
  end if;

  update public.eos_correos_entrantes
     set revisado = true
   where id = v_fila.id;

  return v_movimiento_id;
end;
$$;

revoke execute on function public.eos_finanzas_resolver_correo_v250(text, text) from public, anon;
grant execute on function public.eos_finanzas_resolver_correo_v250(text, text) to authenticated;
