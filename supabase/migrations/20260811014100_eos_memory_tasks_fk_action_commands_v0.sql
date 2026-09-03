-- ============================================================
-- v0 · Dos foráneas que sólo podían ir acá
-- ============================================================
--
-- eos_memory.action_command_id y eos_tasks.action_command_id apuntan a
-- eos_action_commands, que esta misma migración —la anterior,
-- acciones_ejecucion_confiable_v4— acaba de crear.
--
-- Van en un archivo aparte y no dentro de v0 (el esquema base heredado)
-- porque v0 corre ANTES que todo: en ese momento eos_action_commands
-- todavía no existe, y crear la foránea ahí habría vuelto a romper la
-- instalación desde cero, sólo que un paso más adelante.
--
-- El nombre de archivo lleva v0 porque, igual que el esquema base, esto
-- describe algo que ya existía en producción y que ninguna migración
-- había registrado — no es una funcionalidad nueva.

alter table public.eos_memory
  drop constraint if exists eos_memory_action_command_id_fkey;
alter table public.eos_memory
  add constraint eos_memory_action_command_id_fkey
  foreign key (action_command_id) references public.eos_action_commands(id) on delete set null;

alter table public.eos_tasks
  drop constraint if exists eos_tasks_action_command_id_fkey;
alter table public.eos_tasks
  add constraint eos_tasks_action_command_id_fkey
  foreign key (action_command_id) references public.eos_action_commands(id) on delete set null;
