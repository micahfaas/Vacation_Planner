// "How to use" guides — a per-page help pop-up opened from the toolbar's
// How-to button. Content is keyed by ui.view; openHelp(viewKey) renders it.
import { el } from './dom.js';

const HELP = {
  today: {
    title: 'Day',
    intro: 'Your at-a-glance view for the day you are on — what is next and where to go.',
    items: [
      ['Next up', 'A live countdown to your next timed card, so you always know what is coming.'],
      ['Move between days', 'Use the arrows to look ahead or back. It opens to today automatically once your trip has started.'],
      ['Open a card', 'Tap any card to see its details; tap Edit to change it.'],
      ['Directions', 'Tap the directions link on a place to open it in Google Maps.'],
      ['Add something', 'Use the + to add a card to this day.'],
    ],
    note: 'Top bar: the ✨ co-planner suggests things to do, and the 🔔 bell sets booking reminders that notify your phone.',
  },
  calendar: {
    title: 'Calendar',
    intro: 'The big picture — arrange your whole trip across a date grid.',
    items: [
      ['Set your dates', 'Use the Trip dates pickers to set when your trip starts and ends.'],
      ['Add cards', '“+ new card” creates a flight, hotel, activity, meal, and more. Tap a card to view it, Edit to change it.'],
      ['Move things around', 'On a computer, drag cards between days or to the card library on the side. On a phone, add from the Places tab with “Add to calendar.”'],
      ['City stays', 'Multi-night stays show as colored banners spanning their days.'],
      ['Check trip (AI)', 'Scans your plan for problems — tight layovers, overlaps, over-packed arrival days, closures, visa/weather risks, and more.'],
      ['Flights & lounges', 'When you add a flight, tap “Look up flight times” to auto-fill the times and airports from the flight number. If you list your cards and status under About me, eligible airport lounges show on the flight.'],
      ['Sidebar', 'Your card library (cards not yet on a day), trip stats, and a budget panel.'],
    ],
    note: 'Top bar: switch or create trips (including “Trip ideas”), import bookings, and export to your calendar.',
  },
  places: {
    title: 'Places',
    intro: 'Your research library of spots to visit, shown on a map.',
    items: [
      ['Add places', '“+ new place”, or “Import places” to paste a list — even messy, bulleted notes from a chat; the AI sorts it into places.'],
      ['Map & photos', 'Saved places pin on the map. Tap one to open a clean view with a photo, website, and your notes.'],
      ['Near me', 'Tap “Near me” to drop your current location and see how far each place is, sorted nearest-first.'],
      ['Navigate', 'Open turn-by-turn directions to any place in Google Maps.'],
      ['Add to calendar', 'Turn a place into a trip card on a specific day (or send it to your card library).'],
      ['Favorites', 'Tap the star to save a place across all your trips; pull them into a new trip with “From favorites.”'],
      ['Filters', 'Narrow the list by category or by city.'],
    ],
  },
  plan: {
    title: 'Plan',
    intro: 'Compare whole-trip routes side by side, with cash-vs-points cost.',
    items: [
      ['Drafts', 'Build alternative routes (for example, different city orders) and compare them.'],
      ['Stops', 'Each stop has a city, nights, lodging, and a “getting there” — each with a cost and a star rating.'],
      ['Cash or points', 'Set a cost to “points” and a Program field appears (e.g. Avios) that autocompletes from your saved balances.'],
      ['Points & miles', 'Add your balances in the sidebar; pick a draft to see how many points it would leave you.'],
      ['Transfer advisor', 'If a draft needs miles you are short on, it suggests which card points to transfer. “What can my points become?” shows where your flexible points can go.'],
      ['Use this route', 'Commits a draft’s stops onto your calendar.'],
    ],
  },
  resources: {
    title: 'Resources',
    intro: 'Keep your tickets and reading in one place.',
    items: [
      ['Tickets & passes', 'Attach PDFs or photos of tickets and note where to find each one.'],
      ['Blog links & guides', 'Save articles and guides, organized by country and city.'],
    ],
  },
  reminders: {
    title: 'Reminders',
    intro: 'Your trip to-do list and packing checklist.',
    items: [
      ['Reminders', 'Add to-dos with due dates; today’s and overdue items are highlighted.'],
      ['Packing list', 'A simple checklist for what to bring.'],
    ],
    note: 'For booking-window alerts that notify your phone (e.g. when a reservation opens), use the 🔔 Booking reminders button in the top bar instead.',
  },
  journal: {
    title: 'Journal',
    intro: 'Capture the trip as it happens — in words and photos.',
    items: [
      ['Day-by-day story (AI)', 'Generate a narrative for each day, then edit, regenerate, or copy it.'],
      ['Photos', 'Add photos; they are placed automatically on the day they were taken, and you can move or delete them.'],
      ['Share to app', 'From your phone’s Photos app, share pictures straight into the app.'],
    ],
  },
  tools: {
    title: 'Top bar & tools',
    intro: 'These buttons work from any page — your trip-wide tools.',
    items: [
      ['✨ Co-planner', 'Ask the AI for ideas tailored to your trip and your About-me profile — review your plan, fill open days, or suggest restaurants and activities. Tap any suggestion to add it as a card or a saved place.'],
      ['Import bookings', 'Turn confirmations into cards: paste a confirmation email (the AI reads it), upload a PDF or photo (it is scanned), scan a boarding-pass barcode, or connect Google Calendar.'],
      ['Trips', 'Switch between trips, rename or delete them, start a new one, or load the Spain demo. You can also create a read-only Share link to send someone.'],
      ['Trip ideas (in Trips)', 'Enter your points, how many days, and roughly when — it suggests destinations you can actually reach with your miles, and each can become a new trip.'],
      ['🔔 Booking reminders (in More)', 'Get a push notification when a reservation window opens (a restaurant, a tour). Add one with a date or “N days before your trip,” and turn on notifications once on your phone.'],
      ['About me (account menu)', 'Your traveler profile (pace, diet, interests) tunes the co-planner; your points/miles balances power the Plan tab and transfer advisor; your credit cards and elite status decide which airport lounges you can use on flights.'],
      ['More', 'Currency converter, Export JSON (a backup file you can re-import), and Export to calendar (.ics).'],
    ],
  },
};

export function openHelp(viewKey) {
  const h = HELP[viewKey] || HELP.calendar;

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-help' });

  m.appendChild(el('h3', {}, 'How to use · ' + h.title));
  if (h.intro) m.appendChild(el('p', { class: 'vp-help-intro' }, h.intro));

  h.items.forEach(([label, desc]) => {
    m.appendChild(el('div', { class: 'vp-help-item' },
      el('strong', {}, label + ' — '), desc));
  });
  if (h.note) m.appendChild(el('div', { class: 'vp-help-note' }, h.note));

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', {});
  if (viewKey !== 'tools') {
    left.appendChild(el('button', {
      onclick: () => { bg.remove(); openHelp('tools'); }
    }, 'Top bar & tools →'));
  }
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { class: 'vp-save', onclick: () => bg.remove() }, 'Got it'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
