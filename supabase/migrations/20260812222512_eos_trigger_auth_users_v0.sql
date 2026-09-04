-- ============================================================
-- v0 · El disparador que hace que un alta nueva exista de verdad
-- ============================================================
--
-- QUÉ SE ENCONTRÓ
--
-- Investigando el onboarding (punto 12 de la lista de lanzamiento) apareció
-- otro agujero en la reconstrucción desde cero, distinto a los de las tablas
-- y funciones: `on_auth_user_created`, el trigger que engancha
-- `handle_new_user()` a `auth.users`, no lo crea NINGUNA migración.
--
-- Sin este trigger, cuando alguien se registra Supabase inserta la fila en
-- `auth.users` y ahí se queda: `public.usuarios` nunca se crea, y con ella
-- ni el plan, ni el nombre, ni nada de lo que el resto de la aplicación da
-- por sentado que existe. Es, literalmente, lo que hace que un registro
-- sea un registro.
--
-- POR QUÉ NO SE HABÍA DETECTADO ANTES
--
-- La verificación de la instalación desde cero (v0, esquema base heredado)
-- comparó tablas, vistas, funciones, triggers y políticas RLS — pero sólo
-- del esquema `public`. Este trigger vive en `auth.users`, que es del
-- esquema `auth`, y quedó fuera de esa comparación en las dos puntas: ni se
-- buscó en producción, ni se verificó que la reconstrucción lo tuviera. La
-- reconstrucción "pasó" sin haber probado nunca que un alta nueva funcione.
--
-- DE DÓNDE SALE
--
-- De `pg_get_triggerdef()` sobre el trigger real de producción. La función
-- que engancha (`handle_new_user`) ya la crea
-- `20260812222511_eos_funciones_heredadas_v0.sql`, como stub al principio y
-- con su cuerpo real desde `signup_plan_server_owned_v63`; este archivo sólo
-- agrega el enganche, que es lo que faltaba.
--
-- Va justo después de la migración que crea la función, para que el trigger
-- exista desde el primer momento en que hay algo que enganchar — igual que
-- en producción, donde ningún alta se hizo nunca sin él.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
