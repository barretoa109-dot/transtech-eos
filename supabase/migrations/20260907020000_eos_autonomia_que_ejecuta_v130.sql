-- EOS no recordaba nada, y no era la memoria: era la puerta de autonomía.
--
-- ============================================================
-- LO QUE SE VIO USANDO EL PRODUCTO
-- ============================================================
--
-- La cuenta del plan Business preguntó, textual: "¿en serio no recordás nada
-- acerca de los porcinos? de mi negocio?". Y en otra conversación pidió anotar
-- lo que EOS ya sabía en el apartado de negocio; la respuesta fue:
--
--   "La acción quedó sin ejecución automática por la configuración de
--    autonomía actual."
--
-- Las dos cosas son el mismo problema y ninguna estaba en la memoria ni en el
-- ERP. Estaban acá.
--
-- ============================================================
-- CAUSA 1: TRES REGLAS APAGADAS QUE NADIE PUDO PRENDER
-- ============================================================
--
-- Esa cuenta tiene tres filas en `eos_autonomy_rules_v12` —CREAR_TAREA,
-- GUARDAR_MEMORIA y GENERAR_EXCEL— con `enabled = false`. En el gate,
-- `enabled = false` bajaba el nivel a 0, y el nivel 0 significa `recommend`:
-- la acción no se ejecuta.
--
-- Resultado medido en `eos_worker_gate_audit_v15`: todos los GUARDAR_MEMORIA
-- de esa cuenta, desde el 5 de septiembre, con `decision = 'recommend'` y el
-- motivo "La política permite únicamente recomendar esta acción". Su última
-- memoria guardada es del 18 de agosto.
--
-- Y nadie eligió esas filas: **ninguna ruta ni pantalla del producto escribe
-- en esa tabla.** `grep` sobre `app/` y `lib/` solo encuentra lecturas. Son
-- restos de pruebas, y no había forma de apagarlas desde la aplicación.
--
-- El código ya no las lee como "nivel 0" sino como "no hay regla" (ver
-- `lib/worker-gate-handler.ts`). Esta migración borra las tres filas, porque
-- una regla que nadie puede ver ni cambiar no debería seguir existiendo, y
-- porque el `check` de la tabla ni siquiera admite las tres acciones del
-- negocio: es una tabla de excepciones sin interfaz que las cree.
--
-- ============================================================
-- CAUSA 2: EL NIVEL POR DEFECTO ERA "PEDIR PERMISO SIEMPRE"
-- ============================================================
--
-- `default_level` valía 2 desde la v12, y el nivel 2 significa `approval`: la
-- acción queda esperando que la persona vaya a `/eos/autonomy` a aprobarla.
--
-- Nadie corta una conversación para ir a otra pantalla a autorizar que se
-- guarde una nota. Con ese default, toda acción que no fuera una de las tres
-- del negocio —guardar memoria, crear una tarea, armar un Excel, crear un
-- objetivo— terminaba sin ejecutarse. Un chat que promete y no cumple.
--
-- Pasa a 3, que ejecuta. Lo que protege deja de ser una pregunta por acción y
-- pasa a ser el techo diario que ya existe: 40 acciones y 240 puntos de riesgo
-- (v127). Eso frena a un modelo trabado en un bucle, que es el riesgo real.
--
-- Queda dicho qué se pierde: si el modelo entiende mal algo, ahora lo hace en
-- vez de preguntar. Es exactamente lo que se pidió el 3 de septiembre para
-- registrar ventas y ajustar stock —las acciones más caras de equivocar— y no
-- tiene sentido ser más estricto con guardar una nota que con mover el
-- inventario.

-- ============================================================
-- 1) Las reglas huérfanas
-- ============================================================

do $$
declare
  v_filas integer;
begin
  select count(*) into v_filas from public.eos_autonomy_rules_v12 where enabled = false;
  raise notice 'v130: se borran % regla(s) apagada(s) sin interfaz que las cree.', v_filas;
end;
$$;

delete from public.eos_autonomy_rules_v12
where enabled = false;

comment on column public.eos_autonomy_rules_v12.enabled is
  'Si está en false, la regla NO aplica y manda el perfil: no significa "nunca hagas esta acción". Para eso hace falta un bloqueo con su propio motivo, no un booleano que produce el fallo más silencioso posible. Ver v130.';

-- ============================================================
-- 2) El nivel por defecto
-- ============================================================

alter table public.eos_autonomy_profiles_v12
  alter column default_level set default 3;

-- Solo las filas que están en el valor viejo por defecto. Si alguien bajó su
-- propio nivel a mano, esa decisión es suya; el bug era el default.
update public.eos_autonomy_profiles_v12
set default_level = 3,
    updated_at = now()
where default_level = 2;

comment on column public.eos_autonomy_profiles_v12.default_level is
  '0 recomienda, 1 prepara, 2 pide aprobación explícita, 3 ejecuta. El default es 3 desde la v130: con 2, toda acción del chat quedaba esperando una aprobación en otra pantalla y en la práctica no pasaba nada. Lo que acota es el techo diario, no una pregunta por acción.';
