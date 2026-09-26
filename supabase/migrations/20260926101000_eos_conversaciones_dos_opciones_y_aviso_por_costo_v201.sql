-- Conversaciones con dos opciones —Gratis y EOS Conversacional— y el aviso
-- interno por plata en vez de por cantidad de mensajes.
--
-- ============================================================
-- QUÉ DECIDIÓ EL DUEÑO (26/09/2026)
-- ============================================================
--
--   * Gratis: 7 mensajes por día (eran 5).
--   * EOS Conversacional: Gs. 80.000 por mes (eran 60.000). El anual sigue la
--     regla de siempre: doce meses al precio de diez.
--   * En la vitrina, solo esas dos. "Conversaciones" (300 por mes) y
--     "Conversaciones sin freno" (1.000 por mes) salen de la vista.
--   * Aviso interno —a los dueños, nunca a la persona— cuando una cuenta lleva
--     consumidos Gs. 70.000 de IA en el mes, antes de que dé pérdida.
--
-- Un cambio de precio no alcanza a quien ya contrató: el monto de cada armado
-- está congelado en `eos_planes_armados` (v71). Los dos tramos que salen de la
-- vista se apagan con `es_publico` y NO con `activo`: quien ya los tiene los
-- conserva y los renueva igual que hasta hoy.
--
-- ============================================================
-- EL AVISO, POR QUÉ POR COSTO
-- ============================================================
--
-- El de la v184 contaba mensajes (400). Pero lo que da pérdida es la plata, y
-- dos mensajes no cuestan lo mismo: uno con una foto cuesta un orden de
-- magnitud más que un "hola". `uso_mensual.costo_estimado_usd` ya acumula el
-- costo de cada mensaje desde la v89.
--
-- El umbral llega en dólares desde la aplicación (Gs. 70.000 al tipo de cambio
-- configurado, ver `lib/monitoreo/uso-alto.ts`). Si una cuenta tiene costo en
-- cero —las tarifas no estaban cargadas— se la mide por cantidad de mensajes,
-- para que el aviso no quede mudo justo cuando no hay costo que mirar.
--
-- Vale para toda cuenta REAL, con cualquier plan: una cuenta gratis que llega a
-- Gs. 70.000 también es algo que los dueños quieren saber. La tabla de avisos
-- de la v184 se reusa: una vez por cuenta y por mes.

update public.planes
set limite_mensajes = 7
where codigo = 'free'
  and limite_mensajes is distinct from 7;

update public.eos_modulos
set precio_mensual_pyg = 80000,
    precio_anual_pyg = 800000
where codigo = 'conversaciones_full'
  and (precio_mensual_pyg, precio_anual_pyg) is distinct from (80000, 800000);

update public.eos_modulos
set es_publico = false
where codigo in ('conversaciones', 'conversaciones_plus')
  and es_publico;

create or replace function public.eos_uso_sobre_costo_v201(
  p_umbral_usd numeric,
  p_mensajes_sin_costo integer,
  p_solo_nuevas boolean default true,
  p_usuario_id uuid default null
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

  if p_umbral_usd is null or p_umbral_usd <= 0
     or p_mensajes_sin_costo is null or p_mensajes_sin_costo <= 0 then
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
      order by coalesce(m.costo_estimado_usd, 0) desc, m.mensajes_usados desc
    )
    from public.uso_mensual m
    join public.usuarios u on u.id = m.usuario_id
    join public.eos_cuentas_v172 c on c.usuario_id = u.id and c.tipo = 'real'
    where m.periodo = public.eos_periodo_actual()
      and (p_usuario_id is null or m.usuario_id = p_usuario_id)
      and (
        coalesce(m.costo_estimado_usd, 0) >= p_umbral_usd
        or (coalesce(m.costo_estimado_usd, 0) = 0 and m.mensajes_usados >= p_mensajes_sin_costo)
      )
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

revoke all on function public.eos_uso_sobre_costo_v201(numeric, integer, boolean, uuid) from public;
revoke all on function public.eos_uso_sobre_costo_v201(numeric, integer, boolean, uuid) from anon, authenticated;

create or replace function public.eos_marcar_costo_avisado_v201(p_usuarios uuid[])
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
  on conflict (usuario_id, periodo) do nothing;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.eos_marcar_costo_avisado_v201(uuid[]) from public;
revoke all on function public.eos_marcar_costo_avisado_v201(uuid[]) from anon, authenticated;

comment on function public.eos_uso_sobre_costo_v201(numeric, integer, boolean, uuid) is
  'v201: cuentas REALES cuyo costo de IA del mes llegó al umbral en USD (o, con costo en cero, a una cantidad de mensajes). Solo service_role.';
