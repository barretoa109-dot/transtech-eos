begin;

do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'eos_goal_prepare_row'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'eos_goal_prepare_row() no existe';
  end if;

  select pg_get_functiondef(v_oid) into v_def;
  v_old := 'new.fecha_inicio := coalesce(new.fecha_inicio, current_date);';
  v_replacement := 'new.fecha_inicio := coalesce(new.fecha_inicio, (now() at time zone ''America/Asuncion'')::date);';

  if position(v_old in v_def) = 0 then
    raise exception 'Patrón esperado no encontrado en eos_goal_prepare_row()';
  end if;

  v_new := replace(v_def, v_old, v_replacement);
  execute v_new;

  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'eos_process_goal_command'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'eos_process_goal_command() no existe';
  end if;

  select pg_get_functiondef(v_oid) into v_def;
  v_old := 'coalesce(nullif(datos ->> ''fecha_inicio'', '''')::date, current_date)';
  v_replacement := 'coalesce(nullif(datos ->> ''fecha_inicio'', '''')::date, (now() at time zone ''America/Asuncion'')::date)';

  if position(v_old in v_def) = 0 then
    raise exception 'Patrón esperado no encontrado en eos_process_goal_command()';
  end if;

  v_new := replace(v_def, v_old, v_replacement);
  execute v_new;
end $$;

comment on function public.eos_goal_prepare_row() is
  'Normaliza objetivos y usa America/Asuncion para fecha_inicio por defecto.';
comment on function public.eos_process_goal_command() is
  'Procesa comandos idempotentes de objetivos; fecha_inicio automática usa America/Asuncion.';

commit;