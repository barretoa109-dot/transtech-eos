-- "EOS Conversacional" a Gs. 60.000, sin tope para quien lo usa, y un aviso interno cuando el uso se dispara.
--
-- ============================================================
-- QUÉ CAMBIA
-- ============================================================
--
-- El tramo de conversaciones sin tope (`conversaciones_full`) cuesta Gs. 60.000 al
-- mes y se llama "EOS Conversacional". Antes: "Conversaciones ilimitadas" a
-- Gs. 150.000. El cupo no se toca: sigue en -1 (sin tope). Quien lo contrata
-- NUNCA se queda sin poder conversar.
--
-- Un cambio de precio en el catálogo no alcanza a quien ya contrató: el monto
-- de cada armado está congelado en `eos_planes_armados` (ver la v71).
--
-- ============================================================
-- POR QUÉ HACE FALTA UN AVISO
-- ============================================================
--
-- Un mensaje cuesta ~USD 0,05 (medido el 2026-09-19: 7.854 tokens de entrada y
-- 385 de salida). Gs. 60.000 - IVA - comisión de cobro alcanzan para unos 150
-- mensajes por mes; el uso real hoy es de 27 a 68 por cuenta. Sin tope, una
-- cuenta que se dispare cuesta más de lo que paga y nadie se entera hasta fin de
-- mes. Por eso el umbral de 400 mensajes NO corta nada: solo avisa, a los
-- dueños y nunca a la persona, para decidir qué hacer con esa cuenta.
--
-- ============================================================
-- QUÉ AGREGA
-- ============================================================
--
--   eos_avisos_uso_alto_v184   qué cuentas ya se avisaron en qué período, para
--                              que el aviso salga UNA vez por cuenta y por mes.
--   eos_uso_sobre_umbral_v184  cuentas REALES sin tope de mensajes que llegaron
--                              al umbral en el período. Solo lee.
--   eos_marcar_uso_avisado_v184  anota que ya se avisaron. Se llama DESPUÉS de
--                              mandar el correo: si el correo falla, el aviso
--                              se reintenta en la próxima corrida.
--
-- Las cuentas de QA, certificación e internas no cuentan (`eos_cuentas_v172`).
-- Las tres cosas nacen abiertas a anon por los default privileges de la v0: se
-- revocan de forma explícita, y de PUBLIC.

update public.eos_modulos
set
  nombre = 'EOS Conversacional',
  descripcion = 'Hablá con EOS todo lo que necesites, con toda tu memoria y tu contexto. Sin tope de mensajes.',
  precio_mensual_pyg = 60000,
  precio_anual_pyg = 600000
where codigo = 'conversaciones_full';

create table if not exists public.eos_avisos_uso_alto_v184 (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  periodo text not null,
  mensajes integer not null,
  avisado_en timestamptz not null default now(),
  primary key (usuario_id, periodo)
);

alter table public.eos_avisos_uso_alto_v184 enable row level security;

revoke all on table public.eos_avisos_uso_alto_v184 from public, anon, authenticated;
grant select, insert on table public.eos_avisos_uso_alto_v184 to service_role;

comment on table public.eos_avisos_uso_alto_v184 is
  'Cuentas ya avisadas por uso alto de mensajes en un período. Una vez por cuenta y por mes. Solo service_role.';

create or replace function public.eos_uso_sobre_umbral_v184(
  p_umbral integer default 400,
  p_solo_nuevas boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  if p_umbral is null or p_umbral <= 0 then
    raise exception 'EOS_UMBRAL_INVALIDO';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'usuario_id', u.id,
        'email', u.email,
        'plan', coalesce(u.plan, 'free'),
        'mensajes', m.mensajes_usados,
        'costo_usd', round(coalesce(m.costo_estimado_usd, 0)::numeric, 4)
      )
      order by m.mensajes_usados desc
    )
    from public.uso_mensual m
    join public.usuarios u on u.id = m.usuario_id
    join public.planes p on p.codigo = coalesce(u.plan, 'free')
    join public.eos_cuentas_v172 c on c.usuario_id = u.id and c.tipo = 'real'
    where m.periodo = public.eos_periodo_actual()
      and m.mensajes_usados >= p_umbral
      -- Sin tope de mensajes: el cupo del plan es nulo o negativo.
      and (p.limite_mensajes is null or p.limite_mensajes < 0)
      and (
        not p_solo_nuevas
        or not exists (
          select 1
          from public.eos_avisos_uso_alto_v184 a
          where a.usuario_id = u.id and a.periodo = m.periodo
        )
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.eos_uso_sobre_umbral_v184(integer, boolean) from public;
revoke all on function public.eos_uso_sobre_umbral_v184(integer, boolean) from anon, authenticated;

create or replace function public.eos_marcar_uso_avisado_v184(
  p_usuarios uuid[],
  p_umbral integer default 400
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_filas integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EOS_SERVICE_ROLE_REQUIRED';
  end if;

  insert into public.eos_avisos_uso_alto_v184 (usuario_id, periodo, mensajes)
  select m.usuario_id, m.periodo, m.mensajes_usados
  from public.uso_mensual m
  where m.periodo = public.eos_periodo_actual()
    and m.usuario_id = any (coalesce(p_usuarios, '{}'::uuid[]))
    and m.mensajes_usados >= coalesce(p_umbral, 400)
  on conflict (usuario_id, periodo) do nothing;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.eos_marcar_uso_avisado_v184(uuid[], integer) from public;
revoke all on function public.eos_marcar_uso_avisado_v184(uuid[], integer) from anon, authenticated;
