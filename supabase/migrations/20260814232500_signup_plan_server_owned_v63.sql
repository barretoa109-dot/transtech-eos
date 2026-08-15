begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
  v_whatsapp text;
begin
  v_nombre := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    ),
    160
  );

  v_whatsapp := nullif(
    left(btrim(coalesce(new.raw_user_meta_data ->> 'whatsapp', '')), 40),
    ''
  );

  insert into public.usuarios (
    id,
    nombre,
    email,
    whatsapp,
    plan
  ) values (
    new.id,
    v_nombre,
    new.email,
    v_whatsapp,
    'free'
  )
  on conflict (id) do update
  set
    nombre = excluded.nombre,
    email = excluded.email,
    whatsapp = excluded.whatsapp;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

comment on function public.handle_new_user() is
  'RC1 v63: crea el perfil de un usuario Auth con plan free server-owned; nunca confía en raw_user_meta_data.plan.';

commit;
