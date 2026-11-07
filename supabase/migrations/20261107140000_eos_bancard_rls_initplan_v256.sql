-- T-07 del plan maestro de auditoría (07/11/2026): la política de tarjetas
-- reevaluaba auth.uid() fila por fila (v256).
--
-- El Performance Advisor de Supabase marca `auth_rls_initplan` en
-- `eos_bancard_tarjetas_v51_select_own`: la condición `usuario_id =
-- auth.uid()` hace que Postgres llame a `auth.uid()` una vez POR FILA
-- evaluada, en vez de una sola vez por consulta. Con pocas filas no se nota;
-- con la tabla creciendo, cada SELECT paga esa función de más en cada fila.
--
-- El arreglo recomendado por Supabase (y documentado en su guía de RLS) es
-- envolver la llamada en un subselect: `(select auth.uid())`. Postgres lo
-- trata como una subconsulta estable —se resuelve una vez, no por fila— sin
-- cambiar el resultado: el valor de `auth.uid()` es el mismo en toda la
-- consulta.
--
-- Mismo arreglo, no más filas: `ALTER POLICY ... USING` reemplaza solo la
-- condición, no toca el resto de la política (comando, rol, permisiva).

alter policy eos_bancard_tarjetas_v51_select_own
  on public.eos_bancard_tarjetas_v51
  using (usuario_id = (select auth.uid()));
