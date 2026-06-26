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

## First five actions
1. Lock the model. _[DONE]_
2. Build the monetization spine — starting with entitlements + Stripe scaffolding. _[IN PROGRESS]_
3. Add analytics + the reliability fix in the same pass.
4. Build the public landing page at odynaut.com.
5. Start showing up in r/awardtravel and Award Travel 101 (helping, not selling).
