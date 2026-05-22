# Trip Planner

A drag-and-drop trip planner. Build a card library (flights, hotels, activities, transit, meals, notes) and shuffle them around a calendar grid to figure out the order of cities you want to visit. It pairs a vanilla-JS front end with Supabase (auth, sync, and Claude-backed Edge Functions) for AI assists like import parsing, a trip conflict checker, lounge lookup, and an AI-written journal. Trips sync to your account and cache in `localStorage` for offline use; you can also export/import JSON.

## Features

See **[FEATURES.md](FEATURES.md)** for the full, by-tab feature list. Highlights:

- Drag-and-drop calendar across any date range, with multi-day spans and city-stay banners
- Card types with type-specific fields (flights/transit, hotels, activities, meals, notes, city stays)
- AI **Check trip** conflict detector, AI **co-planner** suggestions, and AI **import** (paste email / OCR a PDF / scan a boarding pass / Google Calendar)
- **Places** map, **Plan** itinerary drafts with cash + points/miles math, **Resources**, **Reminders**, and an AI **Journal** with photos
- Lounge access on flight cards based on the cards/status you hold
- Multiple trips, read-only share links, JSON/.ics export, currency converter
- Account sync via Supabase, with `localStorage` offline cache

## Local development

This project is built with [Vite](https://vite.dev). Install dependencies once, then
run the dev server:

```bash
npm install
npm run dev
# open http://localhost:5173
```

To produce a production build in `dist/`:

```bash
npm run build
npm run preview   # serve the build locally to check it
```

## Hosting

`npm run build` emits a static bundle into `dist/`. Deployment to GitHub Pages is
automated by `.github/workflows/deploy.yml`, which builds and publishes on every push
to `main` (Supabase URL/key and the Google client ID are injected from repo Variables).

Signed-in trips sync to your Supabase account; the `localStorage` cache also keeps the
last-loaded trips available offline. Use the JSON export/import buttons to move data
outside your account.

## Project structure

- `index.html` — markup shell and CDN-loaded icon font
- `src/main.js` — app entry point
- `src/*.js` — planner logic split into small ES modules (state, storage, rendering,
  editor, trips, import/export, places, plan, journal, lounges, photos, …)
- `src/data/*.json` — bundled datasets (e.g. lounge catalog)
- `src/styles.css` — styling
- `supabase/functions/*` — Claude-backed Edge Functions (import parsing, co-planner,
  trip-check, trip-journal, flight lookup)
- `supabase/*.sql` — schema, storage buckets, and RLS policies (run in the SQL editor)
- `vite.config.js` — build configuration

No UI framework — just vanilla JS modules bundled by Vite.

## License

MIT — do whatever you want with it.
