# Vacation Planner

A drag-and-drop trip planner that runs entirely in your browser. Build a card library (flights, hotels, activities, transit, meals, notes) and shuffle them around a calendar grid to figure out the order of cities you want to visit. Data saves to `localStorage`, and you can export/import JSON to back up or move between devices.

## Features

- Calendar grid covering whatever date range you set (great for 1–3 week trips)
- Drag cards between the library and any day, or between days
- Card types with type-specific fields: flights and transit get depart/arrive datetimes, hotels get a nights count, activities and meals get a time
- Library filter chips to narrow by card type
- Conflict detection: days with overlapping timed cards get an amber border + warning icon
- Trip math panel: total days, days planned, open days, nights per city, total flight and transit time
- Multiple saved trips, with rename and delete
- JSON export and import
- Auto-saves to `localStorage`
- Light and dark mode (follows OS setting)

## Local use

Just open `index.html` in a browser. There's no build step. If you want to serve it locally:

```bash
cd vacation-planner
python3 -m http.server 8000
# open http://localhost:8000
```

## Hosting on GitHub Pages

1. Create a new GitHub repository (e.g. `vacation-planner`).
2. Push these three files to the repo root: `index.html`, `styles.css`, `app.js`.

   ```bash
   git init
   git add index.html styles.css app.js README.md
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:YOUR-USERNAME/vacation-planner.git
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`, **Branch** to `main` and folder to `/ (root)`, then **Save**.
5. After a minute or two, your planner will be live at `https://YOUR-USERNAME.github.io/vacation-planner/`.

That URL is yours forever. Bookmark it on every device you want to plan from. Note that `localStorage` is per-browser, per-device — use the JSON export/import buttons in the header to sync between devices.

## Files

- `index.html` — markup and CDN-loaded icon font
- `styles.css` — styling, light/dark mode
- `app.js` — all planner logic in one self-contained IIFE

No frameworks. No build. ~600 lines total.

## License

MIT — do whatever you want with it.
