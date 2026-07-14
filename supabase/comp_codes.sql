-- Odynaut — comp (free-access) codes.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A redeemable code that grants a comp subscription (default Pro) for free. Two
-- jobs: (1) seed existing friends/family before launch so flipping GATING_LIVE
-- never suddenly caps them; (2) hand out free access to whoever we like.
--
-- Rotatable: if a code leaks, set active=false and issue a new one. Codes are
-- redeemed ONLY through the redeem-comp-code edge function (service role);
-- clients can neither read nor write these tables (RLS on, no policies).
--
-- Pairs with src/entitlements.js resolveTier (which already honors status='comp'
-- and treats a null current_period_end as never-lapsing) and public.current_tier().

create table if not exists public.comp_codes (
  code             text primary key,               -- stored UPPER-cased; compare case-insensitively
  tier             text not null default 'pro',
  max_redemptions  integer,                         -- null = unlimited
  times_redeemed   integer not null default 0,
  active           boolean not null default true,
  expires_at       timestamptz,                     -- null = never expires
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint comp_codes_tier_check check (tier in ('plus', 'pro'))
);

-- Who redeemed which code. Makes redemption idempotent (a user re-entering the
-- same code doesn't burn a second slot) and gives a simple audit trail.
create table if not exists public.comp_code_redemptions (
  code        text not null references public.comp_codes (code) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

alter table public.comp_codes            enable row level security;
alter table public.comp_code_redemptions enable row level security;
-- No policies on purpose: only the service-role edge function may touch these.

-- Upsert the comp subscription for a user. NEVER downgrades someone who is
-- already paying (status active/trialing) -- their Stripe plan wins; the comp is
-- simply redundant. Otherwise grants the comp tier forever (period_end = null).
create or replace function public.grant_comp_subscription(p_user_id uuid, p_tier text)
returns void
language plpgsql
as $$
begin
  insert into public.subscriptions (user_id, tier, status, source, current_period_end, updated_at)
    values (p_user_id, p_tier, 'comp', 'comp', null, now())
  on conflict (user_id) do update
    set tier = excluded.tier,
        status = 'comp',
        source = 'comp',
        current_period_end = null,
        updated_at = now()
    where public.subscriptions.status not in ('active', 'trialing');
end;
$$;

-- Atomically validate + redeem a code for a user. Returns jsonb:
--   { "ok": true,  "tier": "pro" }                         on success / idempotent re-redeem
--   { "ok": false, "reason": "invalid|inactive|expired|used_up" }
-- Normalizes the code (trim + uppercase) so ' abc123 ' == 'ABC123'.
create or replace function public.redeem_comp_code(p_user_id uuid, p_code text)
returns jsonb
language plpgsql
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row  public.comp_codes%rowtype;
  v_tier text;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_row from public.comp_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Already redeemed by this user: re-apply the entitlement, don't consume a slot.
  if exists (select 1 from public.comp_code_redemptions
             where code = v_code and user_id = p_user_id) then
    perform public.grant_comp_subscription(p_user_id, v_row.tier);
    return jsonb_build_object('ok', true, 'tier', v_row.tier);
  end if;

  if not v_row.active then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Atomic claim: increments only while still under the cap, so concurrent
  -- redeemers can't push times_redeemed past max_redemptions.
  update public.comp_codes
     set times_redeemed = times_redeemed + 1, updated_at = now()
   where code = v_code
     and active
     and (expires_at is null or expires_at > now())
     and (max_redemptions is null or times_redeemed < max_redemptions)
  returning tier into v_tier;

  if v_tier is null then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;

  insert into public.comp_code_redemptions (code, user_id)
    values (v_code, p_user_id)
    on conflict (code, user_id) do nothing;

  perform public.grant_comp_subscription(p_user_id, v_tier);
  return jsonb_build_object('ok', true, 'tier', v_tier);
end;
$$;

-- Only the service-role (the edge function) may run these.
revoke all on function public.grant_comp_subscription(uuid, text) from public;
revoke all on function public.redeem_comp_code(uuid, text) from public;
grant execute on function public.grant_comp_subscription(uuid, text) to service_role;
grant execute on function public.redeem_comp_code(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- Issuing codes (run manually as the owner; edit values as needed). Examples:
--
--   -- A code any friend can use, Pro, up to 100 redemptions, no expiry:
--   insert into public.comp_codes (code, tier, max_redemptions, note)
--     values ('ODYNAUT-FRIENDS', 'pro', 100, 'Launch friends & family');
--
--   -- A single-use Plus code that expires end of 2026:
--   insert into public.comp_codes (code, tier, max_redemptions, expires_at, note)
--     values ('PLUS-ALEX', 'plus', 1, '2026-12-31', 'Alex');
--
--   -- Rotate a leaked code: deactivate it, then issue a fresh one.
--   update public.comp_codes set active = false where code = 'ODYNAUT-FRIENDS';
-- ----------------------------------------------------------------------------
