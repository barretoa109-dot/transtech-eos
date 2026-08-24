-- EOS — Audit log inmutable (fase 5 de la hoja de ruta)
--
-- "Audit log inmutable de cada dato ingerido y cada acción autorizada."
--
-- Ya existía bitácora del lado de la autonomía (`eos_worker_gate_audit_v15`,
-- espejada desde `eos_autonomy_events_v12`), pero con dos huecos para una due
-- diligence: es MUTABLE —`service_role` tiene `grant all`— y no cubre la
-- ingesta, que es justamente por donde entra la plata sin que nadie mire.
--
-- Esta tabla no reemplaza a aquella: es el registro que se le muestra a un
-- auditor o a un cliente corporativo, y el que le contesta al usuario la
-- pregunta "¿de dónde salió este número?".
--
-- ============================================================
-- QUÉ SIGNIFICA "INMUTABLE" ACÁ, SIN EXAGERAR
-- ============================================================
--
--   1. **Append-only por permisos.** Ni `authenticated` ni `service_role`
--      tienen UPDATE ni DELETE. Una clave de servicio filtrada permite leer y
--      agregar, no reescribir el pasado.
--   2. **Append-only por trigger.** Cualquier UPDATE o DELETE aborta, venga de
--      donde venga, incluido el dueño de la tabla.
--   3. **Encadenado por hash.** Cada fila incluye el hash de la anterior. Editar
--      una fila vieja obliga a recalcular todas las siguientes; borrar una del
--      medio deja un hueco en la numeración. `eos_auditoria_verificar_v60()`
--      recorre la cadena y devuelve el primer eslabón roto.
--
-- Lo que esto NO promete, dicho de frente porque un auditor lo va a preguntar:
-- quien tenga acceso de superusuario a la base puede desactivar el trigger y
-- reescribir filas recalculando la cadena entera. Contra eso protege el
-- resguardo externo, no el esquema. Lo que sí queda garantizado es que ninguna
-- credencial de la aplicación —ni la de servicio— puede alterar el registro, y
-- que cualquier manipulación parcial queda evidente.
--
-- Nota de privacidad: acá NO va el cuerpo de los correos bancarios. La página
-- /privacidad promete que no se guarda, y un registro de auditoría no es la
-- excusa para guardarlo. Se registra qué se extrajo y con qué confianza.

-- ============================================================
-- 1) La bitácora
-- ============================================================
create table if not exists public.eos_auditoria_v60 (
  id bigint primary key generated always as identity,
  usuario_id uuid not null references auth.users(id) on delete cascade,

  -- Posición en la cadena de ESE usuario. Un hueco en la secuencia es prueba
  -- de que se borró una fila del medio.
  numero bigint not null,

  evento text not null check (evento in (
    -- Ingesta de datos
    'correo_recibido',
    'movimiento_ingerido',
    'movimiento_descartado',
    'movimiento_confirmado',
    -- Acciones autorizadas
    'accion_autorizada',
    'accion_rechazada',
    -- Datos del usuario
    'datos_exportados',
    'conciliacion_registrada'
  )),

  origen text not null check (origen in ('correo', 'documento', 'chat', 'panel', 'sistema')),

  -- Una línea legible por una persona. Es lo que se le muestra al usuario
  -- cuando pregunta de dónde salió un número.
  resumen text not null,

  -- Estructurado, para poder consultarlo. Sin cuerpos de correo ni secretos.
  detalle jsonb not null default '{}'::jsonb,

  -- Con qué se corresponde: id de correo, de movimiento, de aprobación.
  referencia text,

  hash_previo text not null,
  hash text not null,

  created_at timestamptz not null default now(),

  constraint eos_auditoria_numero_uniq unique (usuario_id, numero),
  constraint eos_auditoria_hash_uniq unique (hash)
);

create index if not exists eos_auditoria_usuario_idx
  on public.eos_auditoria_v60 (usuario_id, numero desc);

create index if not exists eos_auditoria_referencia_idx
  on public.eos_auditoria_v60 (usuario_id, referencia)
  where referencia is not null;

comment on table public.eos_auditoria_v60 is
  'Bitácora append-only y encadenada por hash de cada dato ingerido y cada acción autorizada. No guarda cuerpos de correo ni secretos.';

-- ============================================================
-- 2) El hash de un eslabón
--
-- Una sola definición, usada tanto al escribir como al verificar: si fueran
-- dos, una podría quedar desactualizada y la verificación diría "todo bien"
-- sobre una cadena que ya no calza.
--
-- `created_at` se serializa en UTC con formato fijo a propósito: `::text` sobre
-- un timestamptz depende de la zona y del DateStyle de la sesión, y el mismo
-- dato daría hashes distintos según quién pregunte.
-- ============================================================
create or replace function public.eos_auditoria_hash_v60(
  p_numero bigint,
  p_usuario_id uuid,
  p_evento text,
  p_origen text,
  p_resumen text,
  p_detalle jsonb,
  p_referencia text,
  p_created_at timestamptz,
  p_hash_previo text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    sha256(
      convert_to(
        concat_ws(
          chr(31),  -- separador de unidad: no aparece en texto normal
          p_numero::text,
          p_usuario_id::text,
          p_evento,
          p_origen,
          p_resumen,
          -- jsonb normaliza el orden de las claves, así que su texto es estable.
          p_detalle::text,
          coalesce(p_referencia, ''),
          to_char(p_created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
          p_hash_previo
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- ============================================================
-- 3) Al insertar: la fila se numera, se encadena y se sella sola.
--
-- Nada de esto lo decide quien escribe. `numero`, `hash_previo`, `hash` y
-- `created_at` se calculan acá aunque el insert traiga otros valores: si el
-- que escribe pudiera elegir la fecha, podría antedatar un movimiento.
-- ============================================================
create or replace function public.eos_auditoria_sellar_v60()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero bigint;
  v_hash_previo text;
begin
  -- Serializa por usuario. Dos inserciones simultáneas leerían el mismo
  -- "último eslabón" y armarían dos cadenas paralelas con el mismo `numero`.
  -- El unique lo atraparía, pero fallando el insert en vez de encolarlo.
  perform pg_advisory_xact_lock(hashtext('eos_auditoria_v60'), hashtext(new.usuario_id::text));

  select a.numero, a.hash
  into v_numero, v_hash_previo
  from public.eos_auditoria_v60 as a
  where a.usuario_id = new.usuario_id
  order by a.numero desc
  limit 1;

  new.numero := coalesce(v_numero, 0) + 1;
  new.hash_previo := coalesce(v_hash_previo, 'GENESIS');
  new.created_at := now();

  new.hash := public.eos_auditoria_hash_v60(
    new.numero,
    new.usuario_id,
    new.evento,
    new.origen,
    new.resumen,
    new.detalle,
    new.referencia,
    new.created_at,
    new.hash_previo
  );

  return new;
end;
$$;

drop trigger if exists eos_auditoria_sellar_trg on public.eos_auditoria_v60;
create trigger eos_auditoria_sellar_trg
  before insert on public.eos_auditoria_v60
  for each row execute function public.eos_auditoria_sellar_v60();

-- ============================================================
-- 4) Append-only, de verdad.
-- ============================================================
create or replace function public.eos_auditoria_solo_agregar_v60()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La bitácora de auditoría es append-only: % no está permitido.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists eos_auditoria_solo_agregar_trg on public.eos_auditoria_v60;
create trigger eos_auditoria_solo_agregar_trg
  before update or delete on public.eos_auditoria_v60
  for each row execute function public.eos_auditoria_solo_agregar_v60();

-- ============================================================
-- 5) Verificación de la cadena.
--
-- Es lo que se corre delante de un auditor. Devuelve el primer eslabón roto,
-- no un booleano suelto: "algo está mal" no sirve para investigar.
--
-- Limitación honesta: borrar las ÚLTIMAS filas deja una cadena internamente
-- consistente y no se detecta desde acá. Contra eso protegen el trigger y los
-- permisos, que no dejan borrar nada.
-- ============================================================
create or replace function public.eos_auditoria_verificar_v60()
returns table (ok boolean, revisados bigint, primer_roto bigint, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_previo text := 'GENESIS';
  v_esperado bigint := 0;
  v_roto bigint;
  v_motivo text;
begin
  for r in
    select *
    from public.eos_auditoria_v60 as a
    where a.usuario_id = auth.uid()
    order by a.numero asc
  loop
    v_esperado := v_esperado + 1;

    if r.numero <> v_esperado then
      v_roto := r.numero;
      v_motivo := 'falta el registro número ' || v_esperado::text;
      exit;
    end if;

    if r.hash_previo is distinct from v_previo then
      v_roto := r.numero;
      v_motivo := 'no engancha con el registro anterior';
      exit;
    end if;

    if r.hash is distinct from public.eos_auditoria_hash_v60(
      r.numero, r.usuario_id, r.evento, r.origen, r.resumen,
      r.detalle, r.referencia, r.created_at, r.hash_previo
    ) then
      v_roto := r.numero;
      v_motivo := 'el contenido no coincide con su sello';
      exit;
    end if;

    v_previo := r.hash;
  end loop;

  return query select v_roto is null, v_esperado - (case when v_roto is null then 0 else 1 end), v_roto, v_motivo;
end;
$$;

-- ============================================================
-- 6) Permisos: leer lo propio, escribir solo desde el servidor.
--
-- `authenticated` NO puede insertar: si pudiera, cualquiera fabricaría
-- registros de auditoría desde el navegador y la bitácora dejaría de ser
-- prueba de nada.
-- ============================================================
alter table public.eos_auditoria_v60 enable row level security;

drop policy if exists eos_auditoria_select_propia on public.eos_auditoria_v60;
create policy eos_auditoria_select_propia on public.eos_auditoria_v60
  for select to authenticated using ((select auth.uid()) = usuario_id);

revoke all on table public.eos_auditoria_v60 from anon, authenticated, service_role;
grant select on table public.eos_auditoria_v60 to authenticated;
grant select, insert on table public.eos_auditoria_v60 to service_role;

revoke all on function public.eos_auditoria_sellar_v60() from public, anon, authenticated;
revoke all on function public.eos_auditoria_solo_agregar_v60() from public, anon, authenticated;
grant execute on function public.eos_auditoria_verificar_v60() to authenticated;
grant execute on function public.eos_auditoria_hash_v60(
  bigint, uuid, text, text, text, jsonb, text, timestamptz, text
) to authenticated;
