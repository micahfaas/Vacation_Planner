-- Odynaut — subscriptions / entitlements.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per user describing their current plan. WRITTEN ONLY by the
-- stripe-webhook edge function (service role, which bypasses RLS); clients may
-- READ their own row to resolve which features/limits they get, but can NEVER
-- write it -- so a user cannot grant themselves Pro from the browser.
--
-- Pairs with src/entitlements.js (the client tier logic) and feeds the
-- tier-aware AI quotas in supabase/usage.sql. See PLAYBOOK.md Part 1A.

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  tier                   text not null default 'free',     -- 'free' | 'plus' | 'pro'
  status                 text not null default 'inactive',  -- see check below
  source                 text not null default 'stripe',    -- 'stripe' | 'ios' | 'android' | 'comp'
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text,
  stripe_subscription_id text,
  updated_at             timestamptz not null default now(),
  constraint subscriptions_tier_check
    check (tier in ('free', 'plus', 'pro')),
  constraint subscriptions_status_check
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'inactive', 'comp'))
);

-- The webhook looks rows up by Stripe customer id when an event arrives.
create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

-- Clients may READ their own subscription. No insert/update/delete policies
-- exist, so authenticated/anon clients cannot write the table at all -- only
-- the service-role webhook can. This is intentional; do not add write policies.
drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Effective plan for a user, applying the same "live and not lapsed" rule the
-- client uses (src/entitlements.js resolveTier). Edge functions call this to
-- pick tier-aware AI quotas. Granted to service_role only.
create or replace function public.current_tier(p_user_id uuid)
returns text
language plpgsql
stable
as $$
declare
  r public.subscriptions%rowtype;
begin
  select * into r from public.subscriptions where user_id = p_user_id;
  if not found then
    return 'free';
  end if;
  if r.status not in ('active', 'trialing', 'comp') then
    return 'free';
  end if;
  if r.current_period_end is not null and r.current_period_end < now() then
    return 'free';
  end if;
  return r.tier;
end;
$$;

revoke all on function public.current_tier(uuid) from public;
grant execute on function public.current_tier(uuid) to service_role;
