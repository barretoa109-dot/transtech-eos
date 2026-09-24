-- Lo mínimo de Supabase para aplicar las migraciones sobre un Postgres 16 vacío:
-- roles, auth.uid()/role()/jwt(), storage, cron, vault y la publicación de realtime.
-- Stubs, no la implementación real: sirven para probar esquema, RLS y grants.
-- Ver supabase/pruebas/local/reconstruir.sh.

do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$;
grant anon, authenticated, service_role to authenticator;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin superuser; end if; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
-- (lo fija reconstruir.sh)
-- alter database eos set search_path = public, extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key default extensions.gen_random_uuid(), aud text, role text,
  email text unique, encrypted_password text, email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token text, confirmation_sent_at timestamptz, recovery_token text, recovery_sent_at timestamptz,
  email_change text, last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(),
  phone text, phone_confirmed_at timestamptz, confirmed_at timestamptz, banned_until timestamptz,
  deleted_at timestamptz, is_anonymous boolean default false, is_sso_user boolean default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''), '{}')::jsonb $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], avif_autodetection boolean default false, created_at timestamptz default now(), updated_at timestamptz default now(), owner_id text);
create table storage.objects (id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  metadata jsonb, path_tokens text[], version text, user_metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name),'.',1)) $$;
grant all on storage.objects, storage.buckets to authenticated, service_role;
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text, command text, jobname text unique, active boolean default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare v bigint; begin insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
 on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid into v; return v; end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname=job_name; return true; end $$;
create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$ begin delete from cron.job where jobid=job_id; return true; end $$;
create schema vault;
create table vault.secrets (id uuid primary key default extensions.gen_random_uuid(), name text unique, description text, secret text, key_id uuid, nonce bytea, created_at timestamptz default now(), updated_at timestamptz default now());
create view vault.decrypted_secrets as select *, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language plpgsql as $$
declare v uuid; begin insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into v; return v; end $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language plpgsql as $$
begin update vault.secrets set secret=coalesce(new_secret,secret), name=coalesce(new_name,name) where id=secret_id; end $$;
create publication supabase_realtime;
