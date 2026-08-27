-- Arreglar la resolución de nombres: min(uuid) no existe (v85).
--
-- Los resolvers de la v83 contaban candidatos y tomaban el único con
-- `min(p.id)`. Postgres no tiene `min` para uuid, así que la función explotaba
-- con "function min(uuid) does not exist" apenas la resolución exacta fallaba y
-- había que caer a la búsqueda parcial.
--
-- Se cambia por `(array_agg(p.id))[1]`, que sí agrega uuid. El primero del
-- arreglo sólo se usa cuando hay exactamente un candidato, así que el orden no
-- importa: con dos o más se devuelve null y el ejecutor falla a propósito.
--
-- Lo encontró la prueba del circuito completo antes de que esto llegara a
-- ningún usuario.

create or replace function public.eos_erp_resolver_producto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
begin
  if v_texto = '' then
    return null;
  end if;

  -- Nombre exacto: si alguien escribió el nombre completo, gana sin discusión.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(p.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- Por código, que es como los nombra quien tiene muchos.
  select p.id into v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and lower(btrim(coalesce(p.codigo, ''))) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  /*
   * Parcial, y sólo si no hay dudas.
   *
   * Con "pan" y un catálogo que tiene "Pan casero" y "Pan de leche", devolver
   * cualquiera de los dos sería vender el equivocado. Dos candidatos es un
   * error, no un empate a resolver por orden alfabético.
   */
  select count(*), (array_agg(p.id))[1]
    into v_cuantos, v_id
  from public.eos_erp_productos p
  where p.usuario_id = p_usuario_id
    and p.activo
    and p.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

create or replace function public.eos_crm_resolver_contacto(
  p_usuario_id uuid,
  p_texto text
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
  v_cuantos int;
begin
  if v_texto = '' then
    return null;
  end if;

  select c.id into v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and lower(btrim(c.nombre)) = lower(v_texto)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select count(*), (array_agg(c.id))[1]
    into v_cuantos, v_id
  from public.eos_crm_contactos c
  where c.usuario_id = p_usuario_id
    and c.activo
    and c.nombre ilike '%' || v_texto || '%';

  if v_cuantos = 1 then
    return v_id;
  end if;

  return null;
end;
$function$;

revoke all on function public.eos_erp_resolver_producto(uuid, text) from public, anon, authenticated;
revoke all on function public.eos_crm_resolver_contacto(uuid, text) from public, anon, authenticated;
