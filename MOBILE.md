# Mobile app — kickoff handoff

This is the prompt to paste as the **first message** in a fresh session when you
want to start building the React Native + Expo mobile app. It captures the plan
we agreed on so the new session can pick up without re-deriving anything.

Open decision that session will raise: **where the mobile code lives** — a new
repo vs an `/app` folder here. (See the pros/cons notes you have separately.)

---

```
I want to start building the mobile version of my Trip Planner app ("Hopscotch").
Here's the full context and the plan we already agreed on — please pick it up and
begin with Phase 0.

ABOUT ME / HOW WE WORK
- I'm a non-coder. I direct, decide, and test; you do ALL the implementation, CLI,
  and deploys. Explain things plainly and walk me click-by-click through any
  human-only steps. The app is sign-in gated and you can't see my phone, so give
  exact test steps and I'll verify on-device (and send screenshots).
- This is NOT a Vercel/Next.js project — ignore any Vercel/Next plugin
  suggestions. It's a vanilla-JS web app on GitHub Pages + Supabase, and we're
  building the mobile app in Expo/EAS.

THE PROJECT TODAY
- Hopscotch is a points-aware travel planner. There's a LIVE, feature-complete
  web app: vanilla JS + Vite + Supabase, hosted on GitHub Pages.
  Repo: micahfaas/Vacation_Planner
  Working dir: /Users/micahfaas/Desktop/Personal/Projects/Vacation Planner
- Live features: calendar/drag-drop card planning (flights, hotels, activities,
  transit, meals, notes, city stays) with a tap-to-open card READ VIEW (edit /
  navigate / flight-status / collapsible lounges / attachments / photos);
  Plan tab with itinerary drafts, cash-vs-points cost + a points-program field +
  a transfer-partner advisor; Trip ideas (points -> destinations); AI co-planner;
  Places with a map, "Near me" distance, Google venue photos, and import that
  parses pasted (even bulleted) lists; booking reminders via web push; Journal
  (AI narrative + photos); Day view; import bookings (email/PDF/barcode/GCal);
  About me profile + points balances + lounge access; a "More" header dropdown,
  per-page "How to use" guides, and a first-run guided tour.

GOAL
- Build a true native mobile app, iOS-first, using React Native + Expo as ONE
  codebase for iOS + Android + web (Expo web). The plan is for this to eventually
  replace the vanilla-JS web app so I never maintain two front-ends. The web app
  is stable enough; we're starting the RN build now.

WHAT'S REUSABLE (don't rebuild)
- Backend is 100% reused: Supabase project erpvmsgznmyssnguhpvr (auth, Postgres +
  RLS, Storage) and these deployed edge functions: co-planner, trip-ideas,
  flight-lookup, parse-import, parse-places, trip-check, trip-journal,
  watcher-run, place-photo. Secrets already set: ANTHROPIC_API_KEY,
  AERODATABOX_KEY, GOOGLE_PLACES_KEY, VAPID keys, WATCHER_CRON_SECRET.
- Differentiator LOGIC is plain JS and ports directly: src/transfers.js +
  src/data/transfer-partners.json (transfer advisor), the points/cost math in
  src/plan.js, and src/dates.js. Only the UI layer gets rewritten.

STACK DECISIONS (already chosen)
- Expo (managed) + EAS Build/Submit; Expo Router; Zustand for state (mirrors the
  web app's single mutable state object); MMKV for the local cache; NativeWind for
  styling (map the web palette: warm cream #fefaf2, teal accent #1d8a9c).
- react-native-maps (Apple Maps), expo-notifications (APNs — replaces web push),
  supabase-js + expo-secure-store, expo-apple-authentication (Sign in with Apple,
  required alongside my Google login), reanimated + gesture-handler,
  expo-location (Near me), expo-image-picker/manipulator (later, for journal).

ONE BACKEND CHANGE NEEDED
- watcher-run currently sends web push via VAPID. For native, switch/extend it to
  APNs/Expo push, and have push_subscriptions store device tokens (add a platform
  column). Everything else stays as-is.

CORE FEATURES TO PORT (v1) — keep solid:
- Trip building: calendar/cards + the card read view (tap = read, Edit = form).
- Plan drafts: cash vs points + the points-program field + transfer advisor.
- Trip ideas; co-planner.
- Places + map + "Near me" + Google place photos + the place read view + Add to
  calendar.
- Booking reminders, via native APNs.
DEFER for v1 (don't over-build): heavy client-side import (PDF/OCR/barcode),
Google Calendar import, Journal/photos, Resources.

ONBOARDING NOTE
- The web app's "How to use" guides (src/help.js) and the first-run spotlight tour
  (src/tour.js) are web-specific. The copy/structure is reusable, but rebuild the
  tour natively (e.g. a React Native tour/coachmark approach) rather than porting
  the DOM positioning code.

THE HARD UX PIECE
- The calendar needs a touch-first redesign (vertical day timeline, long-press to
  reorder/move via a sheet, + to add) — NOT a port of the desktop drag-and-drop.

PHASED PLAN
- Phase 0 (do first): scaffold the Expo app (TS + Expo Router), wire the Supabase
  client with secure auth storage, set up the theme from the web palette, build
  the nav skeleton (Calendar/Day · Plan · Places · More), port the pure-logic core
  (transfers, points math, dates), and add auth screens + Sign in with Apple.
- Phase 1: trips list/switcher + the touch-first calendar/day + card CRUD & read
  view.
- Phase 2: Plan drafts + transfer advisor + trip ideas + co-planner.
- Phase 3: Places + Apple Maps + Near me + reminders with APNs.
- Phase 4: polish (haptics, dark mode, empty states, a11y) + the native onboarding
  tour + App Store prep (in-app account deletion, privacy policy, Sign in with
  Apple, screenshots).

LOW-RISK ON-RAMP I WANT
- For Phase 0, get it running on my actual phone via Expo Go — which is FREE and
  does NOT need the $99 Apple Developer account yet (I only need that for
  TestFlight/App Store later). Let me feel a real screen on my phone before we
  commit further.

WORKFLOW NOTES (from the web app)
- Put the mobile app in a new repo or an /app folder; keep supabase/ as the single
  shared backend source.
- I ship via PR + rebase-merge. Fetch origin and confirm local main matches before
  branching (my local has lagged before). Avoid apostrophes in heredoc commit
  messages (they break bash).

Please start by proposing the exact Phase 0 setup (packages, folder structure,
what you'll scaffold) and the first thing I'll be able to run on my phone, then
build it.
```
