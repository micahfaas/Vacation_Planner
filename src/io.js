// JSON export and import.
import { data, activeTrip } from './state.js';
import { save, migrateCard } from './storage.js';
import { render } from './render.js';

export function exportJSON() {
  const t = activeTrip();
  const blob = new Blob([JSON.stringify({
    version: 1,
    trip: {
      name: t.name,
      startDate: t.startDate, endDate: t.endDate,
      cards: t.cards, schedule: t.schedule, library: t.library
    }
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (t.name || 'trip').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const tripData = parsed.trip || parsed;
      const id = 't' + Date.now();
      data.trips[id] = {
        id,
        name: tripData.name || 'Imported trip',
        startDate: tripData.startDate,
        endDate: tripData.endDate,
        cards: tripData.cards || {},
        schedule: tripData.schedule || {},
        library: tripData.library || [],
        libFilter: 'all',
        nextId: (Math.max(0, ...Object.keys(tripData.cards || {}).map(k => parseInt(k.replace('c', '')) || 0)) + 1)
      };
      Object.values(data.trips[id].cards).forEach(migrateCard);
      data.activeTripId = id;
      save(); render();
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    }
  };
  reader.readAsText(file);
}
