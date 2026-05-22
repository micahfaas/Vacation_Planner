# Features

A by-tab inventory of what the app does. Features marked **(AI)** call an
Anthropic/Claude-backed Supabase Edge Function.

## Global (header bar — available from any tab)

- **Trip switcher** — switch, rename, delete, and create multiple trips (plus a demo trip).
- **Trip co-planner (AI)** — itinerary suggestions tailored to your About-me profile.
- **Import bookings** — paste a confirmation email (**AI** parses it into cards), upload a PDF/image (OCR), scan a boarding-pass barcode, or connect Google Calendar.
- **Export JSON** (backup) and **Export to calendar (.ics)**.
- **Share trip** — read-only public link.
- **Currency converter.**
- **Account → About me** — traveler profile (pace, walking, lodging, diet, interests), points/miles balances, and lounge access (the credit cards and elite status you hold).

## Day

- Opens to today automatically when a trip is underway.
- Per-day schedule with a live "Next up" countdown.
- Previous/next day navigation (scrub to any day).
- One-tap directions (Google Maps); booked badges.

## Calendar

- Month grid that switches to an agenda list on narrow screens.
- Trip date-range picker.
- Multi-day city-stay banners and multi-day card spans (split cleanly across week boundaries).
- Drag-and-drop cards between days and the library.
- **Check trip (AI)** — conflict detector: short layovers, schedule overlaps, hotel/city mismatches, ambitious day-of-arrival plans, venue closures, visa/passport rules, weather risk, logistics gaps.
- Draft preview overlays and side-by-side route comparison.
- Sidebar: card library, trip stats, and a budget/cost panel.

## Places

- Places list plus an interactive map (Leaflet) with category icons (restaurant, café, bar, cocktail bar, attraction, shopping, lodging, other).
- Favorites that carry across trips; import places; geocode addresses; pin on map.
- City filter, "add a place as a trip card", directions.

## Plan

- Itinerary drafts — alternative routes you can compare.
- Per-stop fields: city, nights, lodging, "getting there", cost, notes, rating.
- Cash plus points/miles cost per draft, with points-balance running deltas.
- Duplicate / delete drafts; compare drafts directly on the calendar; booking links.

## Resources

- Tickets & passes — attach PDFs/images and note where to access each.
- Blog links & guides, organized by country/city.

## Reminders

- To-do reminders with due dates (today / overdue highlighting).
- Packing-list checklist.

## Journal

- Day-by-day narrative **(AI)** — generate, edit, regenerate, copy.
- Photos — add (auto-compressed client-side), auto-placed on the day matching their EXIF timestamp, with day reassignment and delete.
- "Share to app" from your phone's Photos app (PWA share target).

## Card types (in the card editor)

City stay, Flight, Hotel, Activity, Transit, Meal, Note.

Flight/transit cards add:

- Flight-number lookup (AeroDataBox) that fills times and airports.
- Depart/arrive with per-endpoint timezones.
- Points payment (program + points cost) feeding the Plan tab's balance math.
- Eligible lounges, based on the cards/status in your profile, grouped by airport and departure/arrival.
- Cash cost and file attachments.

Weather appears on the Day view and per stop.

## Data & sync

- Accounts via Supabase Auth; trips sync to your account and cache in `localStorage` for offline use.
- Photos and file attachments live in private Supabase Storage buckets (separate from the database).
