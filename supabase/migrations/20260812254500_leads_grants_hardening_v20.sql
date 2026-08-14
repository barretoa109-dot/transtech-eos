begin;

-- La landing pública inserta leads directamente. Mantener únicamente INSERT
-- para roles cliente; lectura/edición/borrado quedan reservados al servidor.
revoke all on table public.leads from anon, authenticated;
grant insert on table public.leads to anon, authenticated;
grant all on table public.leads to service_role;

commit;
