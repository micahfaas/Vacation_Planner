# Trip Planner

A drag-and-drop trip planner that runs entirely in your browser. Build a card library (flights, hotels, activities, transit, meals, notes) and shuffle them around a calendar grid to figure out the order of cities you want to visit. Data saves to `localStorage`, and you can export/import JSON to back up or move between devices.

## Features

- Calendar grid covering whatever date range you set (great for 1–3 week trips)
- Drag cards between the library and any day, or between days
- Card types with type-specific fields: flights and transit get depart/arrive datetimes, hotels get a nights count, activities and meals get a time
- Library filter chips to narrow by card type
- Multi-day cards (hotels with multiple nights, overnight flights) render as a single bar spanning the relevant days, splitting cleanly across week boundaries
- Conflict detection: days with overlapping timed cards get an amber border + warning icon
- Booked status: mark any card as booked and it turns green with a checkmark badge — the trip math panel shows `booked / total` so you can track progress
- Trip math panel: total days, days planned, open days, booked count, nights per city, total flight and transit time
- Multiple saved trips, with rename and delete
- JSON export and import
- Auto-saves to `localStorage`
- Warm, bright vacation-themed palette

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

`npm run build` emits a static bundle into `dist/`. Because there is now a build step,
deploying to GitHub Pages needs either a GitHub Action that runs the build or a host
that builds automatically — this will be wired up as part of deployment setup.

`localStorage` is per-browser, per-device — use the JSON export/import buttons in the
header to move a trip between devices.

## Project structure

- `index.html` — markup shell and CDN-loaded icon font
- `src/main.js` — app entry point
- `src/*.js` — planner logic split into small ES modules (state, storage, rendering,
  editor, trips, import/export)
- `src/styles.css` — styling
- `vite.config.js` — build configuration

No UI framework — just vanilla JS modules bundled by Vite.

## License

MIT — do whatever you want with it.
