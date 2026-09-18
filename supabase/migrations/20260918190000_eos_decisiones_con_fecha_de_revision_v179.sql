-- Toda decisión nace con fecha de revisión: sin ella nadie vuelve a mirar cómo salió.
--
-- ============================================================
-- QUÉ SE MIDIÓ
-- ============================================================
--
-- Al 2026-09-18, las 15 decisiones de `eos_decisions` (14 capturadas
-- automáticamente desde el chat) tenían `fecha_revision` en null y NINGUNA tenía
-- un resultado evaluado. El ciclo decisión → resultado → aprendizaje que pide
-- el encargo se cortaba en el primer eslabón: no había ninguna fecha en la que
-- alguien tuviera que volver a preguntar "¿y cómo salió?".
--
-- La captura desde el chat vive en n8n y no manda la fecha; tocar ese workflow
-- para esto es más frágil que cerrarlo donde nace el dato.
--
-- ============================================================
-- QUÉ HACE
-- ============================================================
--
-- Un trigger BEFORE INSERT, aparte del `eos_prepare_decision` que ya existe (no
-- se toca), que completa `fecha_revision` con 14 días después de la decisión,
-- contados en hora de Paraguay, SOLO cuando viene vacía. Una fecha que la
-- persona eligió no se pisa.
--
-- Catorce días es el mismo plazo por defecto que ya usa el centro de atención
-- para las decisiones viejas sin fecha (`DIAS_PARA_EVALUAR_DECISION`): dos
-- semanas alcanzan para que una decisión de precio, gasto o cobranza haya
-- tenido efecto visible.
--
-- No se rellenan las 15 existentes: el centro de atención ya las cubre con el
-- plazo por defecto, y escribir fechas retroactivas sería inventar datos.
--
-- Es una función de trigger: nadie la llama por RPC, así que se le revoca todo.

create or replace function public.eos_decisions_revision_por_defecto_v179()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.fecha_revision is null then
    new.fecha_revision :=
      (coalesce(new.fecha_decision, now()) at time zone 'America/Asuncion')::date + 14;
  end if;

  return new;
end;
$function$;

revoke execute on function public.eos_decisions_revision_por_defecto_v179()
  from public, anon, authenticated, service_role;

create trigger eos_decisions_revision_por_defecto_v179
  before insert on public.eos_decisions
  for each row
  execute function public.eos_decisions_revision_por_defecto_v179();
