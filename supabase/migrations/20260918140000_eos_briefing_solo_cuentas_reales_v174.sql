-- El briefing diario dejaba de gastar OpenAI en cuentas que no son clientes.
--
-- ============================================================
-- QUÉ SE MIDIÓ
-- ============================================================
--
-- El workflow de n8n "Briefing personalizado diario v5" lee TODAS las filas de
-- `eos_daily_briefing_context_v5` (hasta 500) y llama a OpenAI por cada una.
-- Esa vista incluye a cualquier cuenta con suscripción no cancelada, así que
-- en los últimos 7 días (medido el 2026-09-18) se generaron 87 briefings y
-- 56 —el 64 %— eran de cuentas de QA, de certificación o internas, más las
-- de personas que llevan meses sin entrar. Cada uno es una llamada al modelo
-- que nadie iba a leer, y además ensucia las métricas de briefing.
--
-- ============================================================
-- CÓMO
-- ============================================================
--
-- La vista original tiene ~16 mil caracteres y n8n la consulta por su nombre.
-- Reescribirla entera para agregarle un filtro es un riesgo de transcripción
-- sin ninguna ganancia, así que se ENVUELVE: la vista actual pasa a llamarse
-- `eos_daily_briefing_context_todos_v174` (misma definición, mismos permisos:
-- el rename los conserva) y el nombre de siempre pasa a ser un filtro sobre
-- ella. n8n no se toca.
--
-- Entra al briefing quien:
--   * es una cuenta REAL (`eos_cuentas_v172`), y
--   * escribió al menos un mensaje en los últimos 30 días, o tiene menos de
--     14 días de vida (una cuenta nueva todavía no tuvo tiempo de escribir).
--
-- Quien vuelve tras un mes sin entrar no tiene briefing el primer día y sí
-- desde el día siguiente a su primer mensaje: preferible a generarle uno
-- todos los días durante meses por si acaso.
--
-- ============================================================
-- CUIDADO AL TOCAR ESTA VISTA DESPUÉS
-- ============================================================
--
-- La definición completa vive ahora en `eos_daily_briefing_context_todos_v174`.
-- Una migración futura que haga `create or replace view
-- public.eos_daily_briefing_context_v5` con el cuerpo completo (como hizo la
-- v162) reemplazaría este filtro y volvería a generar para todas las cuentas.
-- Hay que modificar la vista `_todos_v174`.
--
-- Como todo objeto nuevo en este proyecto nace abierto a anon (default
-- privileges de la v0), se revoca de forma explícita.

alter view public.eos_daily_briefing_context_v5
  rename to eos_daily_briefing_context_todos_v174;

create view public.eos_daily_briefing_context_v5
with (security_invoker = true) as
select c.*
from public.eos_daily_briefing_context_todos_v174 c
where exists (
    select 1
    from public.eos_cuentas_v172 t
    where t.usuario_id = c.usuario_id
      and t.tipo = 'real'
  )
  and (
    exists (
      select 1
      from public.mensajes m
      where m.usuario_id = c.usuario_id
        and m.rol = 'usuario'
        and m.created_at > now() - interval '30 days'
    )
    or exists (
      select 1
      from public.usuarios u
      where u.id = c.usuario_id
        and u.created_at > now() - interval '14 days'
    )
  );

revoke all on table public.eos_daily_briefing_context_v5 from public, anon, authenticated;
grant select on table public.eos_daily_briefing_context_v5 to service_role;

comment on view public.eos_daily_briefing_context_v5 is
  'Entrada del briefing diario de n8n: solo cuentas reales y activas (v174). La definición completa está en eos_daily_briefing_context_todos_v174; modificar ESA, no esta.';

-- ============================================================
-- LO MISMO PARA EL WORKFLOW DE APRENDIZAJE
-- ============================================================
--
-- "Aprendizaje de resultados v7" también es programado, también llama a
-- OpenAI por cada fila de su vista (`eos_learning_context_v7`) y tenía el
-- mismo problema: 8 de las 14 filas eran cuentas que no son clientes (medido
-- el 2026-09-18), y el 32 % de los aprendizajes guardados eran de cuentas de
-- certificación e internas. Mismo envoltorio, mismo criterio de actividad.

alter view public.eos_learning_context_v7
  rename to eos_learning_context_todos_v174;

create view public.eos_learning_context_v7
with (security_invoker = true) as
select c.*
from public.eos_learning_context_todos_v174 c
where exists (
    select 1
    from public.eos_cuentas_v172 t
    where t.usuario_id = c.usuario_id
      and t.tipo = 'real'
  )
  and (
    exists (
      select 1
      from public.mensajes m
      where m.usuario_id = c.usuario_id
        and m.rol = 'usuario'
        and m.created_at > now() - interval '30 days'
    )
    or exists (
      select 1
      from public.usuarios u
      where u.id = c.usuario_id
        and u.created_at > now() - interval '14 days'
    )
  );

revoke all on table public.eos_learning_context_v7 from public, anon, authenticated;
grant select on table public.eos_learning_context_v7 to service_role;

comment on view public.eos_learning_context_v7 is
  'Entrada del aprendizaje de resultados de n8n: solo cuentas reales y activas (v174). La definición completa está en eos_learning_context_todos_v174; modificar ESA, no esta.';
