-- EOS 4.0 RC1 — v29
-- Persistent, privacy-preserving rate limiting for public sales contact requests.
-- Internal state lives outside exposed API schemas; only service_role may consume the limiter RPC.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.eos_public_rate_limits_v29 (
  scope text not null,
  bucket_hash text not null,
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, bucket_hash),
  constraint eos_public_rate_limits_v29_scope_check
    check (char_length(scope) between 1 and 80),
  constraint eos_public_rate_limits_v29_bucket_hash_check
    check (bucket_hash ~ '^[0-9a-f]{64}$'),
  constraint eos_public_rate_limits_v29_request_count_check
    check (request_count >= 0)
);

create index if not exists eos_public_rate_limits_v29_updated_at_idx
  on private.eos_public_rate_limits_v29 (updated_at);

revoke all on table private.eos_public_rate_limits_v29 from public;
revoke all on table private.eos_public_rate_limits_v29 from anon;
revoke all on table private.eos_public_rate_limits_v29 from authenticated;
revoke all on table private.eos_public_rate_limits_v29 from service_role;

create or replace function public.eos_consume_public_rate_limit_v29(
  p_scope text,
  p_bucket_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_count integer;
  v_window_started_at timestamptz;
begin
  if p_scope is null or char_length(p_scope) < 1 or char_length(p_scope) > 80 then
    raise exception 'invalid rate-limit scope' using errcode = '22023';
  end if;

  if p_bucket_hash is null or p_bucket_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate-limit bucket' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid rate-limit limit' using errcode = '22023';
  end if;

  if p_window_seconds is null or p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit window' using errcode = '22023';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into private.eos_public_rate_limits_v29 as rl (
    scope,
    bucket_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_scope,
    p_bucket_hash,
    v_now,
    1,
    v_now
  )
  on conflict (scope, bucket_hash) do update
  set
    request_count = case
      when rl.window_started_at + v_window <= v_now then 1
      else rl.request_count + 1
    end,
    window_started_at = case
      when rl.window_started_at + v_window <= v_now then v_now
      else rl.window_started_at
    end,
    updated_at = v_now
  returning request_count, window_started_at
    into v_count, v_window_started_at;

  -- Bound storage growth without retaining raw identifiers. The index makes this cleanup cheap.
  delete from private.eos_public_rate_limits_v29
  where updated_at < v_now - interval '7 days';

  allowed := v_count <= p_limit;
  remaining := greatest(p_limit - v_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from ((v_window_started_at + v_window) - v_now)))::integer
    )
  end;

  return next;
end;
$$;

revoke all on function public.eos_consume_public_rate_limit_v29(text, text, integer, integer) from public;
revoke all on function public.eos_consume_public_rate_limit_v29(text, text, integer, integer) from anon;
revoke all on function public.eos_consume_public_rate_limit_v29(text, text, integer, integer) from authenticated;
grant execute on function public.eos_consume_public_rate_limit_v29(text, text, integer, integer) to service_role;

comment on function public.eos_consume_public_rate_limit_v29(text, text, integer, integer)
is 'Service-only atomic rate limiter for public EOS server routes. Stores SHA-256 buckets only.';
