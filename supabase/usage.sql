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

-- Per-tier, per-feature monthly caps -- the server-side mirror of the Free/Plus/
-- Pro AI limits in src/entitlements.js TIERS.ai. ai_quota_check resolves the
-- user's plan via public.current_tier() and, when gating is live, enforces the
-- matching row here instead of the flat fallback the edge function passes.
-- Features not listed (parse-import, parse-places) stay tier-agnostic on their
-- flat fallback. KEEP THESE NUMBERS IN SYNC WITH src/entitlements.js TIERS.ai.
create table if not exists public.ai_tier_limits (
  tier          text not null,
  feature       text not null,
  monthly_limit integer not null,
  primary key (tier, feature),
  constraint ai_tier_limits_tier_check check (tier in ('free', 'plus', 'pro'))
);
alter table public.ai_tier_limits enable row level security;  -- service-role only

insert into public.ai_tier_limits (tier, feature, monthly_limit) values
  ('free', 'co-planner',        3),
  ('plus', 'co-planner',        30),
  ('pro',  'co-planner',        100),
  ('free', 'trip-ideas',        5),
  ('plus', 'trip-ideas',        50),
  ('pro',  'trip-ideas',        200),
  ('free', 'destination-guide', 1),
  ('plus', 'destination-guide', 30),
  ('pro',  'destination-guide', 100),
  ('free', 'trip-journal',      1),
  ('plus', 'trip-journal',      20),
  ('pro',  'trip-journal',      60),
  ('free', 'trip-check',        5),
  ('plus', 'trip-check',        60),
  ('pro',  'trip-check',        200)
on conflict (tier, feature) do update set monthly_limit = excluded.monthly_limit;

-- Server-side launch switch: the enforcement analog of GATING_LIVE in
-- src/entitlements.js. While 'false' (the default), ai_quota_check ignores the
-- per-tier caps and uses the flat fallback the edge functions pass -- so NOTHING
-- changes for current users until launch. Flip to 'true' at public launch:
--     update public.app_config set value = 'true' where key = 'gating_live';
-- Instant rollback: set it back to 'false'.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;  -- service-role only
insert into public.app_config (key, value) values ('gating_live', 'false')
  on conflict (key) do nothing;

create or replace function public.gating_active() returns boolean
language sql stable as $$
  select coalesce((select value = 'true' from public.app_config where key = 'gating_live'), false);
$$;

-- Read-only pre-check: returns 'ok' | 'user_limit' | 'global_limit'.
-- Allowlisted users always return 'ok'. p_user_id may be null (then only the
-- global limit applies). TIER-AWARE: when gating is live, the per-user cap comes
-- from public.ai_tier_limits for the user's current_tier(); otherwise p_user_limit
-- (the flat fallback the edge function passes) is used. The global daily cap is
-- always p_global_limit -- a cost circuit breaker independent of tier.
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
  v_user_limit   integer := p_user_limit;
  v_tier         text;
  v_tier_limit   integer;
begin
  if p_user_id is not null
     and exists (select 1 from public.ai_unlimited_users where user_id = p_user_id) then
    return 'ok';
  end if;

  if p_user_id is not null then
    -- Enforce the Free/Plus/Pro caps only once gating is live; until then keep
    -- the flat fallback so current users see no change.
    if public.gating_active() then
      v_tier := public.current_tier(p_user_id);
      select monthly_limit into v_tier_limit
        from public.ai_tier_limits
        where tier = v_tier and feature = p_feature;
      if v_tier_limit is not null then
        v_user_limit := v_tier_limit;
      end if;
    end if;

    select calls into v_user_calls
      from public.ai_usage_user
      where user_id = p_user_id and feature = p_feature and period = v_period;
    if coalesce(v_user_calls, 0) >= v_user_limit then
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
revoke all on function public.gating_active() from public;
grant execute on function public.ai_quota_check(uuid, text, integer, integer) to service_role;
grant execute on function public.ai_quota_increment(uuid, text) to service_role;
grant execute on function public.gating_active() to service_role;

-- Seed the App Review demo account so App Review is never throttled.
insert into public.ai_unlimited_users (user_id, note)
  values ('f24c5379-3d80-4a21-b5b5-35abcbb8cbbf', 'App Review demo account (review@odynaut.app)')
  on conflict (user_id) do nothing;
