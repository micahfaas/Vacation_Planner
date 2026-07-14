# Odynaut Playbook — from free build to a paid app with 1,000+ users

_Last updated: 2026-06-26. Owner: Micah. Working doc — update as decisions change._

---

## 0. Where Odynaut stands today (the review)

**Headline: the product is more built than it needs to be to start charging. What's
missing is the business layer (billing, gating, analytics) and a public front door.**

- **Stack:** Vanilla JS + Vite front end (~56 modules, 7 tabs) on GitHub Pages (free).
  Supabase backend: Auth, Postgres + RLS, Storage, 12 edge functions. Leaflet/OSM maps.
  A separate React Native/Expo mobile app is a parallel track (deferred).
- **Strong already:** full trip planning (drag-drop calendar, 7 card types, day view,
  Plan drafts with cash-vs-points math); the **points/miles engine** (transfer advisor,
  lounge eligibility, points deltas — the moat); **10 AI features** (only co-planner uses
  the pricey Sonnet model ~2–3¢/call, the rest are Haiku <1¢, several cached per trip);
  the **vault** (loyalty numbers, KTN/Redress/CLEAR, document files) and the
  **benefits/credits/expirations tracker** with 30/7/1-day push reminders; demo trip +
  guided tour + per-tab help; privacy/support pages; Apple delete-account function.
- **AI cost guardrails already exist** (`supabase/usage.sql`): per-user/month + global/day
  circuit breaker + an allowlist table — a proto-entitlement we extend.

**The three gaps blocking monetization (all greenfield — confirmed nothing exists):**
1. **No billing** — zero Stripe.
2. **No feature gating / entitlements** — every user gets everything.
3. **No analytics** — zero telemetry; can't see signups/activation/conversion.

**One reliability risk to fix before charging:** trip sync has no full conflict
resolution — a stale tab/device can overwrite newer work. Free users tolerate it; paying
users losing data is fatal. Elevate to "must-fix before launch."

---

## 1. App development needed

### A. Build BEFORE charging — the monetization spine (~2–3 weeks)
1. **Entitlements table** — `subscriptions` (user_id, tier, status, current_period_end,
   source). Extends the existing allowlist pattern. _[BUILT — `supabase/subscriptions.sql`
   + `src/entitlements.js`.]_
2. **Stripe integration** — Checkout + Customer Portal + a `stripe-webhook` edge function
   syncing subscription events → entitlements.
3. **Feature gating (the "locks")** — client tier checks on trip count, vault items,
   benefits reminders, transfer advisor, AI quotas, each with an upgrade nudge.
4. **Tier-aware AI quotas** — extend `ai_quota_check` to take tier. ~80% already built.
5. **In-app upgrade screen** + the nudges at each lock.
6. **Analytics** — Plausible or PostHog (signup → activation → feature use → upgrade).
7. **Reliability fix** — harden trip-sync conflict guard for paid users.

**Free / Plus / Pro split (config-driven in `src/entitlements.js` — tune without code):**

| | Free — Explorer ($0) | Plus ($29/yr) | Pro ($79/yr) |
|---|---|---|---|
| Trips | 1–2 | Unlimited | Unlimited |
| Core planning, Places map | ✅ | ✅ | ✅ |
| Vault | ~5 items | Unlimited | Unlimited |
| Benefits/credits/**expiry reminders** | preview only | ✅ | ✅ |
| Transfer advisor | basic | full | full |
| AI (co-planner/guides/journal) | small taste | generous | highest |
| **Award search (seats.aero)** | — | — | ✅ (when it lands) |
| Alerts/watchers, early access | — | — | ✅ |

### B. Build to support growth
- **Public marketing landing page** at odynaut.com (the app is behind a login wall today —
  this is the highest-leverage growth asset).
- **Referral loop** ("give a month, get a month").
- **Lightweight trip invite/collaboration** (extend the existing share links).
- **Blog surface** for SEO.

### C. Defer (don't block launch)
- **Award search (seats.aero)** — future Pro anchor; start on bring-your-own-Pro ($0 to us).
- **Mobile app to parity** — parallel track; web monetization first (mobile billing via
  RevenueCat takes 15%, so steer signups to web checkout).

---

## 2. Things to set up (accounts & non-code)

- [ ] **Stripe account** — business profile, payout bank, turn on **Stripe Tax** + Customer Portal.
- [ ] **Domains** — confirm/buy odynaut.com (landing) + odynaut.app (app), via Cloudflare.
- [ ] **Transactional email** — Resend (free to 3k/mo): welcome, receipts, reset, lifecycle.
- [ ] **Analytics** — Plausible (~$9/mo) or PostHog (free to 1M events/mo).
- [ ] **Error monitoring** — Sentry free tier.
- [ ] **Legal** — Terms of Service + refund policy; update privacy.html for payments.
- [ ] **Social handles** — claim per brand checklist.
- [ ] **Business entity** — single-member LLC in home state around payment go-live; EIN
      (free) + separate business bank account. (State-dependent — CA has $800/yr franchise tax.)
- [ ] **Later (mobile):** Apple Developer $99/yr, Google Play $25 once, RevenueCat.

---

## 3. Marketing — top places + exact strategy

**Truth:** at $29/yr, paid ads don't pay back. Engine = community + content + word-of-mouth.
**Universal rule:** give value for weeks before mentioning the product, or you'll get banned.

1. **Reddit (#1).** r/awardtravel (bullseye), r/churning, r/CreditCards, r/travel,
   r/solotravel, r/onebag, r/digitalnomad. Help first 2–3 weeks → one honest maker post in
   r/awardtravel offering free Plus to early testers. Never cold-drop links or cross-post spam.
2. **Facebook groups.** Award Travel 101 (~the group), Travel Hacking, Travel Miles 101,
   bank-specific groups. Help first; DM an admin about a "free tool" post.
3. **Points creators (affiliate, pay-on-conversion).** Skip giants; target mid-tier:
   Frequent Miler & Doctor of Credit communities, mid-size YouTubers/TikTokers (Ask Sebby,
   Chase Yokoyama, Daniel Braun), newsletter "tool roundups." Offer free lifetime Pro + a cut.
4. **Product Hunt** — one-time spike once polished + testimonials; line up first-hour upvotes.
5. **Hacker News "Show HN"** — solo-built, privacy-conscious, points engine angle.
6. **SEO/content** — cornerstone guides on real points questions; later programmatic
   "Transfer [bank] → [airline]" pages powered by the transfer-advisor data.
7. **Two positioning wedges** — points optimization (r/awardtravel) AND "one place for every
   passport, confirmation, loyalty number" (the vault) for family/solo-travel groups.

**Sequence:** M1 landing page + free tier + start commenting · M1–2 maker posts, ~50–100
testers on free Plus · M2–3 creator affiliates · M3 Product Hunt + Show HN · ongoing SEO + referral.

---

## 4. Watching size/cost + scaling triggers

| Watch | Where | Free ceiling | Trigger → action | Scaled cost |
|---|---|---|---|---|
| DB + file storage | Supabase | ~500MB DB / ~1GB storage | ~0.8GB → Supabase Pro or move files to Cloudflare R2 | Pro $25/mo; R2 ~$0.015/GB no egress |
| Edge invocations / MAU | Supabase | ~500k / 50k MAU | nearing → Supabase Pro | in $25/mo |
| AI spend (co-planner is the dial) | Anthropic console + `ai_usage_global` | pay-go | rising → tighten free quotas (no app update needed) | Haiku <1¢, Sonnet ~2–3¢ |
| Google Places | Google Cloud billing | ~$200/mo credit | nearing → budget cap + cache more | ~$17–32 per 1k calls |
| AeroDataBox | RapidAPI | few hundred/mo | nearing → paid tier | ~$10–30/mo |
| Email | Resend | 3k/mo | growth → paid | $20/mo for 50k |
| MRR / churn / refunds | Stripe | — | weekly | revenue |
| Signup → activation → conversion | PostHog/Plausible | generous | weekly | $0–9/mo |

**Levers already working:** quota/circuit-breaker, per-trip caching (destination-guide,
trip-check), Haiku for all but co-planner, AI behind paid tiers once gated. **Add at scale:**
move vault/photo files to Cloudflare R2 (no egress fees).

**Founder routine:** weekly glance at 5 numbers (signups, activation %, free→paid %, MRR, AI
daily spend); monthly check usage bars vs ceilings.

**Cost trajectory:** today ~$2–5/mo (domains) · 100–500 users ~$25–75/mo · 1k–5k users
~$100–400/mo. Wildcard = seats.aero (start bring-your-own-Pro).

---

## 5. Pricing — LOCKED (2026-06-26)

- **Free "Explorer" $0**, **Plus $29/yr** (or $3.99/mo), **Pro $79/yr** (or $8.99/mo).
- **Annual-first** (monthly offered but steered away from): fixes ~18% Stripe fees on $2
  charges and kills monthly churn — the "forget-about-it" MRR engine.
- **Award search = the Pro anchor** when seats.aero lands; until then Pro = max AI + alerts +
  founding perks.
- Optional capped **Founding Lifetime Plus $79** (first ~100) for early cash + evangelists.
- **Why not flat $2:** points/miles audience pays more; flat $2 needs ~1,240 subs for $3k MRR.

---

## 6. Go-to-paid build plan — LOCKED (2026-07-11)

**Phase-0 limits (encoded in `src/entitlements.js` TIERS — the one place to tune):**

| | Free "Explorer" $0 | Plus $29/yr | Pro $79/yr |
|---|---|---|---|
| Trips | 2 | Unlimited | Unlimited |
| Vault items | 5 | Unlimited | Unlimited |
| Benefits/credits | view-only (no expiry reminders) | + expiry reminders | + expiry reminders |
| Transfer advisor | basic lookup | full / personalized | full / personalized |
| AI co-planner / ideas per mo | 3 / 5 | 30 / 50 | 100 / 200 |
| Award search (seats.aero) | — | — | ✅ (when it ships) |

- **Founding Lifetime Plus $79 one-time** = Plus forever (a `subscriptions` row `tier='plus'`,
  `current_period_end=null`). Configurable sold-out cap `LIFETIME_PLUS_CAP` (~100), enforced
  server-side in `create-checkout-session`.
- The **global daily co-planner safety cap (~40/day)** stays regardless of tier (server circuit
  breaker in `usage.sql`).

**Two launch flags in `entitlements.js`, both `false` today, both instant rollbacks:**
- `CHECKOUT_LIVE` — upgrade buttons call Stripe (true) vs. show "almost ready" (false).
- `GATING_LIVE` — enforce the Free limits (true) vs. everyone gets everything (false).

**Everything below ships DARK behind these flags. Friends/family stay on the live app throughout.
Nothing user-facing changes until the final flip. Confirm with Micah before flipping any flag or
touching prod / live secrets.**

- **Phase 1 — Wire the real feature locks.** Today only the trips gate exists (`trips.js`) and it's
  inert. Add: vault-item cap, benefits expiry reminders (Plus+), transfer-advisor basic-vs-full,
  AI client pre-checks. Each = check + `requireUpgrade()` nudge, all guarded by `gatingActive()`.
- **Phase 1.5 — Friends comp-code.** A redeemable code granting Pro free: a `comp_codes` table
  (code, tier=pro, max_redemptions, times_redeemed, active, optional expiry — rotatable) + a
  service-role edge fn that validates (active + under cap) and writes a `subscriptions` row
  `status='comp'` (`resolveTier` already honors 'comp'; comp never lapses) + an "enter code" UI.
  Also the mechanism to seed existing friends/family before launch.
  **BUILT (2026-07-12):** `supabase/comp_codes.sql` (comp_codes + comp_code_redemptions
  tables; `redeem_comp_code()` = atomic, idempotent, never over-cap, never downgrades a
  paying user; `grant_comp_subscription()`), `supabase/functions/redeem-comp-code/`
  (authenticated edge fn), `redeemCompCode()` in billing.js, and an "enter code" UI
  (account menu → "Redeem a code" + a "Have an invite code?" link in the upgrade modal).
  Comp codes work regardless of the CHECKOUT_LIVE/GATING_LIVE flags. **Deploy steps (Micah):**
  (1) apply `comp_codes.sql` in the Supabase SQL editor; (2) `supabase functions deploy
  redeem-comp-code` (JWT ON — no `--no-verify-jwt`); (3) issue codes via the INSERT examples
  at the bottom of the SQL file (e.g. `ODYNAUT-FRIENDS`, Pro, cap 100).
- **Phase 2 — Tier-aware SERVER AI quotas.** `ai_quota_check` isn't tier-aware; make the AI edge
  functions read `current_tier()` (or pass `aiLimitFor`) so the caps enforce server-side, not just
  in the client.
  **BUILT (2026-07-12):** all in `supabase/usage.sql` — a `ai_tier_limits` table (tier × feature →
  monthly cap, seeded to mirror entitlements.js), and `ai_quota_check` now resolves the caller's
  plan via `current_tier()` and applies the tier cap. **No edge-function redeploys needed** (the
  function is replaced by name). Behind a server switch `app_config.gating_live` (default `false`,
  the enforcement analog of the client `GATING_LIVE`) so nothing changes for current users until
  launch. **Deploy step (Micah):** re-run `supabase/usage.sql` (idempotent). At launch, flip BOTH
  the client `GATING_LIVE=true` AND `update public.app_config set value='true' where key='gating_live';`.
- **Phase 3 — Trip-sync conflict hardening.** Stop a stale device/tab from clobbering newer trip
  edits. MUST be done before charging real money. **ALREADY DONE (commit 303bed6, 2026-06-24) — the
  §0 "sync has no conflict resolution" note above is STALE.** storage.js implements optimistic
  concurrency: per-trip `updated_at` versions (`loadedVersions`), a compare-and-swap guarded UPDATE
  (`.eq('updated_at', base)`) that turns a blind last-write into a detectable conflict, conflict
  reload + user toast (server wins, never silent loss), and refresh-on-focus/visibility/online that
  folds in remote changes without clobbering pending local edits. RLS scopes every trip op to the
  owner. 2026-07-12 added an explicit `user_id` filter on the delete (defense-in-depth). Verdict:
  sufficient to charge money. Optional future upgrades (NOT launch blockers): Supabase Realtime for
  live multi-tab sync, field-level merge instead of server-wins.
- **Phase 4 — Analytics** (Plausible or PostHog): instrument the upgrade funnel (modal open →
  checkout start → success) + key activation events.
  **BUILT (2026-07-12):** Plausible (privacy-first, cookieless, no PII), all in `src/analytics.js`
  behind an `ANALYTICS_LIVE` switch (default false — nothing loads or sends until you turn it on).
  Provider-swappable: only analytics.js changes to move to PostHog. Instrumented: the funnel
  `Upgrade: Modal Opened` → `Upgrade: Checkout Started` → `Upgrade: Purchase Completed`, plus
  `Comp Code Redeemed`, `Trip Created`, and `AI Used` (feature). Verified dark (no console errors,
  no Plausible request while off). **Go-live (Micah):** (1) add the app's domain as a site in
  plausible.io; (2) set `PLAUSIBLE_DOMAIN` in analytics.js to that exact site name; (3) set
  `ANALYTICS_LIVE = true` and redeploy; (4) confirm events land in the Plausible dashboard.
- **Phase 5 — Marketing landing page.** odynaut.com currently serves the APP; decide root-vs-app
  routing (marketing at root, app at app.odynaut.com or /app), then build a simple landing page.
  **BUILT (2026-07-12):** self-contained on-brand page at `landing/index.html` (+ copied logo assets)
  — hero, two wedges (points / vault), 6 features, Free/Plus/Pro pricing, privacy strip, CTAs.
  Inline CSS mirroring the app's palette; no external deps; responsive (verified desktop + mobile,
  no console errors). Recommended routing = **app → odynaut.app, landing → odynaut.com** (matches the
  billing APP_URL default); CTAs currently point at `https://odynaut.app` (search `ROUTING:` comments
  in the file to change). **Deploy steps (Micah, DNS/hosting — my auto-mode can't touch prod):**
  (1) host `landing/` at odynaut.com (a separate GitHub Pages repo with a CNAME, or Cloudflare Pages);
  (2) set THIS repo's Pages custom domain to odynaut.app and add `public/CNAME` = `odynaut.app` so it
  persists across deploys; (3) point both domains' DNS accordingly. The app's Stripe success/cancel
  URLs already derive from the Origin header, so they follow the app to odynaut.app automatically.
- **Phase 6 — Business/legal (Micah-led, I assist):** LIVE-mode Stripe products/prices/keys/webhook,
  Stripe Tax + Customer Portal, ToS/Privacy/refund policy, LLC/EIN, live Supabase secrets
  (`sk_live`, `whsec`, the 4 `STRIPE_PRICE_*` ids). The auto-mode classifier blocks me from deploying
  to prod / handling live secrets — Micah drives those steps. **DRAFTED (2026-07-12):** legal pages
  `public/terms.html`, `public/refund.html` (14-day money-back default), and `public/privacy.html`
  updated for Stripe payments + Plausible analytics; a point-of-purchase consent line in the upgrade
  modal, account-menu "Terms & refunds" entry, and landing footer links. Execution checklist below (§7).
- **Phase 7 — Staged launch:** seed friends/family comp rows → flip `CHECKOUT_LIVE=true` (soft test
  purchase) → flip `GATING_LIVE=true`. Both flags are instant rollbacks.

**After web paid tiers ship → build ANDROID** for the Odynaut mobile app (separate repo:
`hopscotch-mobile`, Expo/RN, iOS-first today): EAS Android build + Google Play Console listing +
mobile monetization via RevenueCat (converges with the deferred mobile-billing step). Coordinate
with Poursmith's parallel Android+RevenueCat work — same RevenueCat account, batch the Play
Console/billing setup.

---

## 7. Phase 6 — go-live execution checklist (Micah drives; I can't touch prod/live secrets)

**A. Fill the legal placeholders** — search `[BRACKETS]` in `public/terms.html`, `public/refund.html`,
`public/privacy.html` and replace:
- `[LEGAL ENTITY NAME]` → your LLC or sole-prop name
- `[STATE]` / `[STATE / COUNTY]` → governing-law state (in terms.html §13)
- `[SUPPORT EMAIL]` → e.g. support@odynaut.com (or micahfaas@gmail.com for now)
- `[EFFECTIVE DATE]` → the publish date (all three files)
- Confirm the **refund window** — drafted as a 14-day money-back guarantee; change if you prefer.

**B. Business entity** (advisory, state-dependent; can start as sole proprietor):
- Single-member LLC in your home state + free EIN (irs.gov) + a business bank account.
- Turn on Stripe Tax regardless. CA note: $800/yr franchise tax — tailor to your state.

**C. Stripe LIVE setup** (in the Stripe dashboard, LIVE mode):
1. Activate the account (business profile + payout bank).
2. Create Products & Prices: **Plus** recurring $29/yr and $3.99/mo; **Pro** recurring $79/yr and
   $8.99/mo; **Founding Lifetime Plus** as a **one-time** price of $79. Copy all 5 Price IDs (`price_…`).
3. Settings → **Tax**: enable Stripe Tax.
4. Settings → Billing → **Customer portal**: enable it (allow cancel + update payment method).
5. Developers → **Webhooks** → add endpoint: URL =
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events =
   `customer.subscription.created|updated|deleted`. Copy the signing secret (`whsec_…`).
6. Copy your live secret key (`sk_live_…`).

**D. Supabase live secrets** (`supabase secrets set NAME=value`, or dashboard → Edge Functions → Secrets):
- `STRIPE_SECRET_KEY` = `sk_live_…`
- `STRIPE_WEBHOOK_SECRET` = `whsec_…` (from the LIVE webhook)
- `STRIPE_PRICE_PLUS_YEAR`, `STRIPE_PRICE_PLUS_MONTH`, `STRIPE_PRICE_PRO_YEAR`, `STRIPE_PRICE_PRO_MONTH`
- `STRIPE_PRICE_LIFETIME` = the one-time Founding Lifetime price id
- (optional) `LIFETIME_PLUS_CAP` = `100` (sold-out ceiling; defaults to 100 if unset)
- (optional) `APP_URL` = `https://odynaut.app`
The 3 Stripe functions read these at runtime — no code change needed. (Keep deploying `stripe-webhook`
with `--no-verify-jwt`.)

**E. Publish** the legal pages + landing so `/terms.html`, `/refund.html`, `/privacy.html` are live.

**Founding Lifetime Plus SKU — BUILT (2026-07-12).** `create-checkout-session` now takes
`tier:'lifetime'` → a `mode:'payment'` one-time checkout, with a best-effort sold-out check against
the count of `source='lifetime'` rows (cap = `LIFETIME_PLUS_CAP`, default 100). `stripe-webhook`
grants it from `checkout.session.completed` (writes `tier='plus'`, `status='active'`,
`source='lifetime'`, `current_period_end=null` = never lapses). The upgrade modal shows a "Founding
offer — Plus for life, $79 once" banner to free users. No DB schema change (the `source` column is
free text). Micah's only extra step is creating the one-time Stripe price + setting
`STRIPE_PRICE_LIFETIME` (above).

## 8. Phase 7 — flip-day runbook (staged launch)

**Prereqs (all of §7 done, deployed DARK):** comp_codes.sql applied; the 3 changed/new functions
deployed; LIVE Stripe products/prices/webhook created; live Supabase secrets set; app shipped with
all flags still false (`CHECKOUT_LIVE`, `GATING_LIVE`, server `app_config.gating_live`, `ANALYTICS_LIVE`).
At this point NOTHING has changed for current users.

**Flags & how each flips / rolls back:**
| Flag | Where | Flip = | Rollback |
|---|---|---|---|
| `CHECKOUT_LIVE` | `src/entitlements.js` const | code edit → PR → rebase-merge (auto-deploy) | revert commit → deploy |
| `GATING_LIVE` (client) | `src/entitlements.js` const | code edit → deploy | revert → deploy |
| `gating_live` (server) | `public.app_config` row | `update … set value='true'` (instant) | set back to `'false'` (instant) |
| `ANALYTICS_LIVE` | `src/analytics.js` const | code edit → deploy | revert → deploy |

**Order of operations:**
1. **Seed friends/family as comp** so nobody is suddenly capped. Run in SQL editor:
   ```sql
   insert into public.subscriptions (user_id, tier, status, source, updated_at)
   select id, 'pro', 'comp', 'comp', now() from auth.users
   on conflict (user_id) do nothing;
   ```
   (Grants every current user comp Pro forever. Run again anytime new pre-launch friends sign up, or
   hand them a comp code instead.)
2. **Flip `CHECKOUT_LIVE=true`** (client edit → deploy). Do a **real soft-test purchase** yourself
   (Plus monthly, $3.99) with a real card → confirm the webhook wrote your `subscriptions` row and the
   app shows Plus → **refund it** in the Stripe dashboard. Also test the Manage-plan portal. If
   anything's wrong, roll back `CHECKOUT_LIVE` and fix before proceeding.
3. **Turn on enforcement together:** flip client `GATING_LIVE=true` (edit → deploy) **and** run
   `update public.app_config set value='true' where key='gating_live';`. Now Free limits + tier-aware
   server AI quotas are live. Spot-check as a fresh free account.
4. **(Optional) Flip `ANALYTICS_LIVE=true`** after setting the Plausible domain; confirm events land.
5. Announce. Watch Stripe + the funnel for the first days.

**Instant panic button:** `update public.app_config set value='false' where key='gating_live';` stops
server-side enforcement immediately; revert the `GATING_LIVE`/`CHECKOUT_LIVE` commits to stop the rest.

## First five actions
1. Lock the model. _[DONE]_
2. Build the monetization spine — starting with entitlements + Stripe scaffolding. _[IN PROGRESS]_
3. Add analytics + the reliability fix in the same pass.
4. Build the public landing page at odynaut.com.
5. Start showing up in r/awardtravel and Award Travel 101 (helping, not selling).
