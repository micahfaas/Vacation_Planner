# Odynaut go-to-market — testers + first paying users

_Created 2026-07-16. Owner: Micah. Companion to PLAYBOOK.md (§3 marketing, §4 cost/scaling)._
_This doc = the 90-day plan. PLAYBOOK = the product/pricing/launch mechanics._

---

## 0. The reframe: these are two different funnels

| | Tester motion | Paid motion |
|---|---|---|
| **Who** | ~40 capped, hand-picked, warm | Strangers, unbounded |
| **Currency** | Free Pro (comp code) + your attention | Free tier + a paywall they hit |
| **You learn** | What's broken, what's loved | What people will pay for |
| **Success** | They come back unprompted | free → paid % |
| **Timing** | Weeks 1–4 | Day 31+ |

**The trap:** a tester on a comp code never sees a paywall, so they teach you
**nothing** about willingness to pay. The friends/family seed SQL already granted
every existing user comp Pro *forever*. They are goodwill and feedback — they are
not pricing data. You need both cohorts running in parallel, and you must not let
the comp code leak into the paid cohort.

**The gate between them:** do not do the public push (big Reddit post, Product
Hunt, Show HN) until **≥30–40% of testers return in week 2 without being nudged**.
Product Hunt and Show HN are one-shot channels. Spending them on a product that
doesn't retain is the single most expensive mistake available to you.

---

## 1. Reality check on the money

- $29/yr nets ~$27.86 after Stripe (2.9% + 30¢). $79 Pro nets ~$76.
- 100 Plus subscribers = **$2,900/yr ≈ $242/mo**. That is not income; it's validation.
- The PLAYBOOK's "few thousand/mo" goal needs ~1,240 Plus subs. That is a 2–3 year
  organic arc, not a 90-day one.
- Typical prosumer freemium free→paid = **2–5%**; a high-intent niche can hit 5–8%.
  So ~30 paying customers needs roughly **600–1,000 signups**.

**Honest 90-day target: 300–600 signups, 15–40 paying, $450–1,600 ARR.**
The goal of this quarter is a *validated funnel*, not revenue.

---

## 2. Timeline

### First 2 weeks — instrument, protect, recruit (NO public push)

**Analytics (day 1).** See §4 + the app's `src/analytics.js`. Nothing else in this
doc works without it.

**Cost caps (day 1–2).** A traffic spike must not be able to cost you real money:
- Anthropic Console → **monthly spend limit** (set $50).
- Google Cloud → Places API → **Quotas → daily request cap** (e.g. 1,000/day).
  A *budget alert does not stop spend* — only a quota cap does. Set both.
- The co-planner global circuit breaker (40/day ≈ $30/mo) already caps your worst
  case. Note the side effect: during a spike it degrades to "AI is taking a
  breather" for *everyone*, including brand-new users. Before the day-31 push,
  consider raising to ~100/day (~$75/mo worst case) so first impressions survive.

**Legal (start now, must finish before day 31).** See §6.

**Recruit 20–40 testers.** Sources, warmest first:
1. Existing friends/family already on comp (they're in — just re-engage them).
2. Points-community Discords/Slacks where you're already a member.
3. Award Travel 101 (FB) — **DM an admin first**, ask permission for a
   "free tool, looking for testers" post. Most groups say yes if you ask.
4. r/awardtravel — **do not post yet.** Only comment helpfully.

**Tester mechanics:**
- One comp code, `max_redemptions` ≈ 40, rotate it. **Never post it publicly** —
  a code on Reddit gets shared until the cap burns.
- Comp grants Pro *forever* (`current_period_end=null`). For 40 evangelists that's
  a fine trade. Just know you can never convert them.
- 40 comp Pro users ≈ up to $100/mo of AI at the per-user cap; the 40/day global
  breaker holds the real ceiling near $30/mo.

**Feedback loop — do not rely on "email me your thoughts":**
- 20-minute calls with 8–10 of them. Highest signal you will get all quarter.
- A 5-question form for the rest.
- The two questions that matter: *"What would annoy you most if I took it away?"*
  and *"Would you pay $29/yr — and if not, why not?"*
- Watch PostHog for where they stop.

**Good at day 14:** 20+ redeemed · 12+ created a real (non-demo) trip · 5+
substantive feedback items · 3+ say they'd pay · **≥30% returned in week 2.**

### Days 15–30 — fix, and start showing up

- Fix the top 3 things testers hit. Nothing else.
- Reddit presence: 2–3 genuinely helpful comments/day in r/awardtravel, ~20
  min/day. **No links.** You are a points maximizer — this is your home turf and
  your unfair advantage. You're buying credibility you'll spend on day 31.
- r/churning: read-only, and use the weekly threads. It bans self-promo hard.
- Write the maker post now; sit on it.
- Set up the welcome email (Resend, free to 3k/mo). It's still unchecked in
  PLAYBOOK §2 and it's the cheapest activation lever you have.

**Good at day 30:** top-3 tester complaints fixed · 100+ karma of real help in
r/awardtravel · welcome email live · LLC + insurance done or in flight.

### Days 31–60 — the maker posts, first real paid conversions

- **r/awardtravel maker post.** DM the mods first. Honest, free-tier-first, no
  paywall pressure. Angle: *"I built a free trip planner that tells you which of
  your points actually cover an award."* Expect 200–1,500 visits → 30–150 signups.
- **Award Travel 101 (FB)** the same week, admin-permitted.
- **Tag every link with UTMs** (`?utm_source=reddit&utm_campaign=awardtravel-post`).
  PostHog captures these automatically; without them you can't tell what worked.
- This is where the *paid* cohort begins. Watch which gate fires (§4).

**Good at day 60:** 150–400 signups · 40%+ activation · first 5–15 paying · the
gate data tells you which limit drives upgrades.

### Days 61–90 — spend the one-shot channels

- **Product Hunt.** Needs testimonials + polish. Line up first-hour upvotes.
- **Show HN.** Angle: solo-built, privacy-first, *cookieless analytics, no
  autocapture, no session recording*. That is a genuine HN talking point and you
  can now back it up.
- **Creator affiliates** (PLAYBOOK §3.3): mid-tier only, pay-on-conversion, free
  lifetime Pro + a cut.
- **SEO groundwork.** Your sleeper asset: `src/data/transfer-partners.json` is
  structured data you already own. Programmatic *"Transfer [bank] points to
  [airline]"* pages are a real, compounding organic channel that nobody else in
  this niche does well. Start 1 cornerstone post/week from week 3.

**Good at day 90:** 300–600 signups · 15–40 paying · ≥1 channel with a repeatable
signup→paid rate · you know your #1 upgrade trigger.

---

## 3. Positioning: two wedges, one product

- **Points wedge** (r/awardtravel, churning, creators): "which of your points
  actually cover this award." Sharp, differentiated, high intent.
- **Vault wedge** (r/travel, r/solotravel, family groups): "every passport,
  confirmation, and loyalty number in one private place." Broader, lower intent,
  much bigger market.

Lead with **points** for the first 90 days. It's a smaller pond where you're a
credible native, and it converts. The vault wedge is the year-2 expansion.

---

## 4. Measurement

### What's instrumented (as of 2026-07-16)

| Event | Props | Fires when |
|---|---|---|
| `Signed Up` | `provider` | New account, any provider _(added 2026-07-16)_ |
| `Trip Created` | — | Activation proxy |
| `AI Used` | `feature` | Any AI feature |
| `Upgrade: Modal Opened` | `plan`, `source` | Paywall hit or menu open _(`source` added 2026-07-16)_ |
| `Upgrade: Checkout Started` | `tier`, `interval` | Stripe redirect |
| `Upgrade: Purchase Completed` | `tier` | Confirmed entitlement |
| `Comp Code Redeemed` | `tier` | Tester onboarding |
| `Landing CTA Clicked` | `cta` | odynaut.com CTA _(added 2026-07-16)_ |

`source` values: `trip-limit`, `vault-limit`, `benefits-reminders`,
`transfer-advisor`, `points-hint`, `ai-limit:<feature>`, `menu`.
**This is your most valuable pricing signal** — it tells you which limit actually
drives upgrades, so you can tune `src/entitlements.js` instead of guessing.

### The cookieless tradeoff — read this before trusting a funnel

`cookieless_mode: 'always'` means PostHog identifies visitors with a **rotating
daily server-side hash**. Consequences:
- ✅ Same-day/same-session funnels stitch fine (modal → checkout → purchase).
- ❌ **Cross-day journeys do not stitch.** "Signed up June 3, paid June 20" is
  invisible to PostHog.
- ❌ odynaut.com → odynaut.app is a different domain: no per-user join. Compare at
  the cohort level (landing visits vs. signups), not per person.

**So: use PostHog for in-app behavior, and Supabase/Stripe for long-range
conversion** — which are authoritative anyway. Run this monthly:

```sql
-- Signup → paid conversion by weekly cohort (the real number)
select date_trunc('week', u.created_at) as cohort,
       count(*) as signups,
       count(s.user_id) filter (where s.status = 'active') as paid,
       round(100.0 * count(s.user_id) filter (where s.status = 'active')
             / nullif(count(*), 0), 1) as pct
from auth.users u
left join public.subscriptions s
  on s.user_id = u.id and s.status = 'active'   -- excludes 'comp' testers
group by 1 order by 1 desc;
```

If you later decide multi-day PostHog funnels matter more than the purist stance,
the one-line change in `src/analytics.js` is `cookieless_mode: 'always'` →
`persistence: 'localStorage'`. Still no cookies; arguably needs EU consent.

### The weekly 5 (revenue motion)

| # | Metric | Source | Target | If it's off |
|---|---|---|---|---|
| 1 | Landing visit → signup | PostHog cohort | 5–10% | Landing copy/CTA |
| 2 | Signup → activation (`Trip Created` ≤7d) | PostHog | 40%+ | Onboarding is the leak |
| 3 | Activation → paywall hit (`source` ≠ `menu`) | PostHog | 30%+ in 30d | <10% ⇒ **free tier too generous** |
| 4 | Paywall hit → `Checkout Started` | PostHog | 10–20% | Price/value framing |
| 5 | `Checkout Started` → `Purchase Completed` | PostHog + Stripe | 60%+ | <40% ⇒ checkout broken or price shock |

Plus: MRR, refunds/chargebacks, Anthropic daily spend.

### The weekly 5 (tester motion)

Redeemed · % created a real trip · **week-2 unprompted return rate (the gate)** ·
feedback items collected · # who say they'd pay.

---

## 5. PostHog setup (do this first)

See the walkthrough in the chat transcript / `src/analytics.js` header. Summary:
1. posthog.com → free account → project. Note region (US/EU) + `phc_…` key.
2. **Project settings → Web analytics → enable "Cookieless server hash mode."**
   Without this, `cookieless_mode: 'always'` drops every event.
3. `.env` → `VITE_POSTHOG_KEY=phc_…` (+ `VITE_POSTHOG_HOST` if EU).
4. GitHub → repo → Settings → Secrets and variables → Actions → **Variables** →
   `VITE_POSTHOG_KEY` (same name; CI reads it in `deploy.yml`).
5. `landing/index.html` → paste the same key into `PH_KEY`.
6. `src/analytics.js` → `ANALYTICS_LIVE = true` → PR → merge → auto-deploys.
7. Verify in PostHog → **Activity / Live events**.

Rollback: set `ANALYTICS_LIVE = false` and redeploy (or just clear the repo
variable — no key means analytics stays off, by design).

---

## 6. Risks and how they're handled

### LLC + insurance — **yes, a public push changes the urgency**

**Note the actual situation: MF Consulting, LLC already exists (Oregon).** You are
not un-formed — you're *not operating through it*. Per PLAYBOOK §7 the Terms name
"Micah Faas" personally, Stripe is verified as Individual/sole-prop on your SSN,
and revenue lands in a personal savings account.

That distinction matters, because it's worse than it sounds: an LLC you don't
respect doesn't shield you. Commingling funds and signing contracts in your
personal name are exactly the facts a plaintiff uses to **pierce the veil**. Today
you're carrying the LLC's cost with none of its protection.

**An LLC is also not retroactive** — it only covers conduct while you're properly
operating through it. So this has to be true *before* the day-31 push, not after.

The chain, in order (EIN is the one real blocker):
1. **EIN.** The online tool errors out constantly. **Fax Form SS-4 — ~4 business
   days**, vs ~1 month by mail. That beats your day-31 gate; the mailed route doesn't.
2. **Business bank account** (needs the EIN). Stop commingling — this is the single
   biggest veil-piercing fact against you.
3. **Stripe → company/LLC**, payouts to the business account.
4. **Terms/Privacy/Refund entity** → "MF Consulting, LLC dba Odynaut."
   Confirm the exact registered name (comma or not) on the Oregon SoS registry.

Oregon has no CA-style $800 franchise tax, so the carrying cost is just the annual
report. There's no reason to be in this half-state.

**Insurance:** tech E&O + cyber, roughly $500–1,500/yr for a solo SaaS this size
(Vouch, Coalition, Hiscox, Thimble). Cheap against one breach. Get a quote in
week 1 — bind before the public push. Worth doing **regardless** of the LLC, since
an LLC doesn't pay for a breach response.

_Not legal advice — but the sequencing above is the part that's actually urgent._

### Stripe: new account, first real charges

- **Statement descriptor = `ODYNAUT`.** A descriptor people don't recognize is the
  #1 cause of chargebacks. Set it before any traffic.
- Complete the business profile + identity verification **now**, while volume is
  zero. Verification under load is where holds happen.
- Expect a delayed first payout (7–14 days) and possibly a rolling reserve. Normal.
- Keep ToS / refund policy linked at checkout — Stripe reviews this.
- **Enable Billing → "upcoming renewal" emails.** Critical for annual: a $29 charge
  12 months later that nobody remembers agreeing to is a chargeback.
- **Refund instantly and liberally.** A refund costs $29; a chargeback costs $15 +
  your dispute ratio. Above ~0.75% disputes you risk the account.
- The staged rollout here also protects you: 0→500 charges overnight triggers
  automated review; a gradual ramp doesn't.

### Marketing Pro when award search doesn't exist

The points community has a long memory and punishes hype. Selling a $79 tier on a
feature you don't control (seats.aero needs a commercial license or BYO-Pro key —
see `project_seats_aero_research`) is the one move that could cost you the
community's trust permanently.

**Recommendation: stop marketing Pro on award search entirely.**
- Make **Plus the hero.** It's the honest offer and the volume tier.
- Reposition Pro as *"max AI + alerts + early access + founding perks"* — things
  that exist today.
- Move award search to a public **roadmap** page. **Never give a date** for
  something gated on someone else's API.
- If you keep it on the pricing card, label it *"not yet available — don't buy Pro
  for this yet."* In r/awardtravel that kind of honesty is a marketing asset.
- Currently `landing/index.html` and `src/upgrade.js` both say "Award search
  (coming soon)" on the Pro card. That's the wording to change.

### AI/API cost spikes

Mostly already handled (PLAYBOOK §4) — the co-planner global breaker is a real
ceiling. The **uncapped** exposures are Google Places (autocomplete burns fast
past the $200/mo credit) and AeroDataBox. Fix with hard quota caps, not budget
alerts (§2, first 2 weeks). Also consider Supabase Pro ($25) before the push.

### Solo support

- **One channel** (email). No Discord, no chat — they're time sinks at this stage.
- Answer in **two batches a day**, not continuously. Publish "solo founder, I reply
  within 2 business days" on the support page — people are fine with it if it's stated.
- Canned responses for: refund, password reset, "how do I X".
- The top 5 repeated questions become FAQ entries. Support volume is a product bug.
- The 40-tester cap is itself the capacity control.
- **If it takes off: close signups behind a waitlist.** Better than bad service,
  and scarcity does you no harm.

### Others worth naming

- **Trademark.** Field is clear except a board game in Class 28
  (`project_brand_domain_socials`). A public launch is exactly when someone else
  files. Consider an intent-to-use in Class 9/42 (~$250–350/class) before Product Hunt.
- **GDPR.** EU users are plausible. Cookieless analytics + the existing
  delete-account function cover most of it. Know the 72-hour breach-notification
  clock exists.
- **Annual refund tension.** 14 days is the policy; someone will ask in month 11.
  Enforce the policy, but eat the $29 rather than earn an enemy in a small community.
- **Welcome/renewal email is still not set up.** It's both an activation lever and
  chargeback insurance. Day 15–30.
