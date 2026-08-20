-- EOS Finanzas — buzón de ingesta por correo
--
-- Principio 1 de la doctrina: "cero carga manual como objetivo. Cargar un
-- gasto manualmente debería ser una excepción, no el funcionamiento normal."
--
-- Sin APIs bancarias abiertas en Paraguay, el camino más corto a ese principio
-- es el correo: el banco ya le manda al usuario un aviso por cada movimiento.
-- Si ese aviso llega también a EOS, los movimientos entran solos.
--
-- Cada usuario recibe una dirección propia e inadivinable. El token ES la
-- credencial: quien lo conozca puede inyectar movimientos, por eso se genera
-- con `gen_random_bytes` y nunca se deriva del email ni del id del usuario.

-- ============================================================
-- 1) Buzón por usuario.
-- ============================================================
create table if not exists public.eos_finanzas_buzon (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  -- Local part de la dirección de ingesta. Inadivinable a propósito.
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  activo boolean not null default true,
  -- Trazabilidad mínima para que el usuario vea que el buzón está vivo.
  ultimo_correo_en timestamptz,
  correos_recibidos integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.eos_finanzas_buzon is
  'Dirección de ingesta por correo de cada usuario. El token es una credencial: quien lo tenga puede inyectar movimientos.';

-- ============================================================
-- 2) Correos procesados.
--
--    NO se guarda el cuerpo del correo. Son avisos bancarios: contienen
--    saldos, números de cuenta y datos de terceros. Guardamos lo mínimo
--    para (a) no procesar dos veces el mismo correo y (b) poder mostrarle
--    al usuario qué entró. El cuerpo vive en Resend 30 días y con eso alcanza.
-- ============================================================
create table if not exists public.eos_correos_entrantes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  -- email_id de Resend. UNIQUE = idempotencia: el webhook puede reintentar.
  email_id text not null unique,
  remitente text,
  asunto text,
  recibido_en timestamptz not null default now(),
  movimientos_detectados integer not null default 0,
  -- 'procesado' | 'sin_movimientos' | 'error'
  estado text not null default 'procesado'
    check (estado in ('procesado', 'sin_movimientos', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists eos_correos_usuario_fecha_idx
  on public.eos_correos_entrantes (usuario_id, recibido_en desc);

-- ============================================================
-- 3) 'correo' como origen válido de un movimiento.
--
--    La columna ya distinguía manual/documento/chat/integracion/estimado.
--    El correo es su propia procedencia: no es un documento que el usuario
--    subió ni una integración bancaria formal.
-- ============================================================
alter table public.eos_movimientos_financieros
  drop constraint if exists eos_movimientos_financieros_origen_check;

alter table public.eos_movimientos_financieros
  add constraint eos_movimientos_financieros_origen_check
  check (origen in ('manual', 'documento', 'chat', 'integracion', 'estimado', 'correo'));

-- ============================================================
-- 4) RLS.
--
--    El usuario puede LEER su buzón y sus correos, pero no crearlos ni
--    modificarlos: el token lo genera la base y el webhook escribe con
--    service_role. Si el usuario pudiera hacer UPDATE del token podría
--    apuntarse al buzón de otro.
-- ============================================================
alter table public.eos_finanzas_buzon enable row level security;
alter table public.eos_correos_entrantes enable row level security;

drop policy if exists finanzas_buzon_select on public.eos_finanzas_buzon;
create policy finanzas_buzon_select on public.eos_finanzas_buzon
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy if exists correos_entrantes_select on public.eos_correos_entrantes;
create policy correos_entrantes_select on public.eos_correos_entrantes
  for select to authenticated using ((select auth.uid()) = usuario_id);

-- ============================================================
-- 5) Provisión del buzón.
--
--    Se crea bajo demanda con SECURITY DEFINER en vez de con un trigger de
--    signup, porque los usuarios que ya existen también necesitan el suyo.
--    Devuelve el token existente si ya lo tenía: llamarla dos veces no
--    rota la dirección (rotarla dejaría de funcionar la regla de reenvío
--    que el usuario ya configuró en su correo).
-- ============================================================
create or replace function public.eos_finanzas_obtener_buzon_v53()
returns table (token text, activo boolean, correos_recibidos integer, ultimo_correo_en timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;

  insert into public.eos_finanzas_buzon (usuario_id)
  values (v_usuario)
  on conflict (usuario_id) do nothing;

  return query
    select b.token, b.activo, b.correos_recibidos, b.ultimo_correo_en
    from public.eos_finanzas_buzon b
    where b.usuario_id = v_usuario;
end;
$$;

revoke all on function public.eos_finanzas_obtener_buzon_v53() from public;
grant execute on function public.eos_finanzas_obtener_buzon_v53() to authenticated;

-- ============================================================
-- 6) Contador del buzón.
--
--    Lo llama el webhook con service_role. Es cosmético (le muestra al
--    usuario que su buzón está vivo y cuándo entró el último correo), por
--    eso el webhook ignora su error en vez de fallar la ingesta.
-- ============================================================
create or replace function public.eos_finanzas_registrar_correo_v53(p_usuario_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.eos_finanzas_buzon
     set correos_recibidos = correos_recibidos + 1,
         ultimo_correo_en = now()
   where usuario_id = p_usuario_id;
$$;

revoke all on function public.eos_finanzas_registrar_correo_v53(uuid) from public;
grant execute on function public.eos_finanzas_registrar_correo_v53(uuid) to service_role;
