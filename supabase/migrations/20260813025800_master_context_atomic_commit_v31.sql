begin;

create or replace function public.eos_commit_master_context_v31(
  p_request_id uuid,
  p_trigger_source text,
  p_identidad jsonb,
  p_estado_actual jsonb,
  p_objetivos jsonb,
  p_proyectos jsonb,
  p_compromisos jsonb,
  p_alertas jsonb,
  p_decisiones_recientes jsonb,
  p_aprendizajes jsonb,
  p_proxima_mejor_accion jsonb,
  p_resumen_compacto text,
  p_source_fingerprint text,
  p_fuentes