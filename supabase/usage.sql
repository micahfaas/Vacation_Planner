-- AI usage metering + quotas (cost guardrails) for the co-planner and
-- trip-ideas edge functions. Enforced server-side before each Anthropic call;
-- only SUCCESSFUL calls are counted. All limits are passed in by the edge
-- functions, so they are tunable without an app update. Apply with:
--   supabase db query --linked -f supabase/usage.sql
-- See project_ai_cost_guardrails for the agreed numbers and rationale.

-- Per-user, per-feature, per-calendar-month successful-call counts (UTC).
create table if not exists public.ai_usage_user (
  user_id    uuid not null references auth.users(id) on delete cascade,
  feature    text not null,                 -- 'co-planner' | 'trip-ideas'
  period     text not null,                 -- 'YYYY-MM' (UTC)
  calls      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature, period)
);

-- Global, per-feature, per-day successful-call counts: the cost circuit breaker.
create table if not exists public.ai_usage_global (
  feature    text not null,                 -- 'co-planner' | 'trip-ideas'
  day        date not null,                 -- UTC date
  calls      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (feature, day)
);

-- Users who bypass ALL AI quotas (owner + trusted friends + the App Review
-- demo account). Doubles as the future "free friend access" mechanism.
create table if not exists public.ai_unlimited_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- These tables are touched only by edge functions using the service-role key
-- (which bypasses RLS). Enable RLS with no policies so anon/authenticated
-- clients can neither read nor write them directly.
alter table public.ai_usage_user      enable row level security;
alter table public.ai_usage_global     enable row level security;
alter table public.ai_unlimited_users  enable row level security;

-- Read-only pre-check: returns 'ok' | 'user_limit' | 'global_limit'.
-- Allowlisted users always return 'ok'. p_user_id may be null (then only the
-- global limit applies).
create or replace function public.ai_quota_check(
  p_user_id uuid,
  p_feature text,
  p_user_limit integer,
  p_global_limit integer
) returns text
language plpgsql
as $$
declare
  v_period       text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_day          date := (now() at time zone 'utc')::date;
  v_user_calls   integer;
  v_global_calls integer;
begin
  if p_user_id is not null
     and exists (select 1 from public.ai_unlimited_users where user_id = p_user_id) then
    return 'ok';
  end if;

  if p_user_id is not null then
    select calls into v_user_calls
      from public.ai_usage_user
      where user_id = p_user_id and feature = p_feature and period = v_period;
    if coalesce(v_user_calls, 0) >= p_user_limit then
      return 'user_limit';
    end if;
  end if;

  select calls into v_global_calls
    from public.ai_usage_global
    where feature = p_feature and day = v_day;
  if coalesce(v_global_calls, 0) >= p_global_limit then
    return 'global_limit';
  end if;

  return 'ok';
end;
$$;

-- Record one successful call. Per-user usage is always recorded (useful for
-- stats); allowlisted users do NOT consume the global daily budget, so the
-- owner's own testing cannot trip the circuit breaker for everyone else.
create or replace function public.ai_quota_increment(
  p_user_id uuid,
  p_feature text
) returns void
language plpgsql
as $$
declare
  v_period    text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_day       date := (now() at time zone 'utc')::date;
  v_unlimited boolean := false;
begin
  if p_user_id is not null then
    insert into public.ai_usage_user (user_id, feature, period, calls, updated_at)
      values (p_user_id, p_feature, v_period, 1, now())
      on conflict (user_id, feature, period)
      do update set calls = public.ai_usage_user.calls + 1, updated_at = now();

    select exists (select 1 from public.ai_unlimited_users where user_id = p_user_id)
      into v_unlimited;
  end if;

  if not v_unlimited then
    insert into public.ai_usage_global (feature, day, calls, updated_at)
      values (p_feature, v_day, 1, now())
      on conflict (feature, day)
      do update set calls = public.ai_usage_global.calls + 1, updated_at = now();
  end if;
end;
$$;

-- Only the service-role (used by edge functions) may execute these.
revoke all on function public.ai_quota_check(uuid, text, integer, integer) from public;
revoke all on function public.ai_quota_increment(uuid, text) from public;
grant execute on function public.ai_quota_check(uuid, text, integer, integer) to service_role;
grant execute on function public.ai_quota_increment(uuid, text) to service_role;

-- Seed the App Review demo account so App Review is never throttled.
insert into public.ai_unlimited_users (user_id, note)
  values ('f24c5379-3d80-4a21-b5b5-35abcbb8cbbf', 'App Review demo account (review@odynaut.app)')
  on conflict (user_id) do nothing;
