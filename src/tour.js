// Guided walk-through tour. A spotlight + arrow + tooltip steps the user
// page-by-page through the core features. Shown once on first open (dismissible,
// remembered), and replayable from the More menu.
//
// First run loads the Spain demo so the arrows point at real content, and ends
// with "Start my first trip" — which removes the demo and lands on a fresh trip.
import { ui, data } from './state.js';
import { render } from './render.js';
import { el } from './dom.js';
import { loadDemoTrip } from './demo.js';
import { newTripId, markTripDirty, markTripDeleted, save } from './storage.js';
import { isoDate } from './dates.js';

const SEEN_KEY = 'vp_tour_seen';
export function tourSeen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ } }

// Each step: which tab to show, what to point at (CSS selector; null = centered),
// and the copy. Targets are stable buttons/areas that exist regardless of data.
const STEPS = [
  { view: 'calendar', target: null, title: 'Welcome to Odynaut 👋',
    body: 'A quick tour of how to plan a points-savvy trip. We loaded a sample trip so you can see everything in action.' },
  { view: 'calendar', target: '.vp-view-toggle', title: 'Your trip tabs',
    body: 'Switch between Day, Calendar, Places, Plan and more. Every tab also has a “How to use” button for details.' },
  { view: 'calendar', target: '.vp-newcard-btn', title: 'Add cards',
    body: 'Add flights, hotels, activities and more here. Tap any card afterward to open it; tap Edit to change it.' },
  { view: 'calendar', target: '.vp-tc-btn', title: 'Check your trip',
    body: 'The AI scans for problems — tight layovers, overlaps, closures, and over-packed arrival days.' },
  { view: 'calendar', target: '#vp-coplan-btn', title: 'Ask the co-planner',
    body: 'Get AI ideas tailored to your trip and your tastes — fill open days, find restaurants — then tap a suggestion to add it.' },
  { view: 'calendar', target: '#vp-import-btn', title: 'Import bookings',
    body: 'Turn confirmations into cards: paste an email, upload a PDF or photo, scan a boarding pass, or connect Google Calendar.' },
  { view: 'plan', target: '.vp-plan-side', title: 'Points & miles',
    body: 'Add your balances and the Plan tab shows a route’s cost in cash or points — and which card points to transfer to cover it.' },
  { view: 'plan', target: '#vp-account-btn', title: 'Your profile & points',
    body: 'Set up your traveler profile and your points/miles balances under About me — they power the co-planner and the Plan tab’s cost and transfer advice.' },
  { view: 'places', target: '.vp-nearme-btn', title: 'Places & “Near me”',
    body: 'Save spots to a map. “Near me” shows how far each one is while you’re out exploring.' },
  { view: 'calendar', target: '.vp-help-btn', title: 'Need a reminder?',
    body: 'Tap “How to use” on any page for a quick guide to that page’s features.' },
  { view: 'calendar', target: '#vp-more-btn', title: 'More tools',
    body: 'Reminders, currency, and exports live here — and you can replay this walk-through anytime.' },
  { view: 'calendar', target: '#vp-trips-btn', title: 'Trips & trip ideas',
    body: 'Switch or create trips here. Not sure where to go? “Trip ideas” turns your points and free days into destinations you can actually reach.' },
  { view: 'calendar', target: null, title: 'Ready to go ✈️',
    body: 'That’s the tour! Start your own trip now — we’ll tuck the sample trip away.', finish: true },
];

let state = null; // { index, demoId, els:{...}, onResize }

export function startTour(replay) {
  if (state) return; // already running
  const demoId = replay ? null : loadDemoTrip(); // loadDemoTrip switches to + renders the demo

  const backdrop = el('div', { class: 'vp-tour-backdrop' });
  const spotlight = el('div', { class: 'vp-tour-spotlight' });
  const arrow = el('div', { class: 'vp-tour-arrow' });
  const tip = el('div', { class: 'vp-tour-tip' });
  document.body.appendChild(backdrop);
  document.body.appendChild(spotlight);
  document.body.appendChild(tip);
  tip.appendChild(arrow);

  state = { index: 0, demoId, els: { backdrop, spotlight, arrow, tip }, onResize: null };
  state.onResize = () => position();
  window.addEventListener('resize', state.onResize);

  showStep(0);
}

function showStep(i) {
  state.index = Math.max(0, Math.min(STEPS.length - 1, i));
  const step = STEPS[state.index];
  if (ui.view !== step.view) { ui.view = step.view; render(); }
  renderTip(step);
  // Let the freshly-rendered view settle before measuring.
  requestAnimationFrame(() => requestAnimationFrame(position));
}

function renderTip(step) {
  const { tip, arrow } = state.els;
  tip.innerHTML = '';
  tip.appendChild(arrow);
  tip.appendChild(el('div', { class: 'vp-tour-step' }, (state.index + 1) + ' of ' + STEPS.length));
  tip.appendChild(el('div', { class: 'vp-tour-title' }, step.title));
  tip.appendChild(el('div', { class: 'vp-tour-body' }, step.body));

  const row = el('div', { class: 'vp-tour-actions' });
  if (!step.finish) {
    row.appendChild(el('button', { class: 'vp-tour-skip', onclick: () => endTour(false) }, 'Skip'));
  }
  const right = el('div', { class: 'vp-tour-right' });
  if (state.index > 0) {
    right.appendChild(el('button', { class: 'vp-tour-back', onclick: () => showStep(state.index - 1) }, 'Back'));
  }
  if (step.finish) {
    right.appendChild(el('button', { class: 'vp-tour-next vp-save', onclick: () => endTour(true) }, 'Start my first trip'));
  } else {
    right.appendChild(el('button', { class: 'vp-tour-next vp-save', onclick: () => showStep(state.index + 1) }, 'Next'));
  }
  row.appendChild(right);
  tip.appendChild(row);
}

function position() {
  if (!state) return;
  const step = STEPS[state.index];
  const { backdrop, spotlight, tip, arrow } = state.els;
  const target = step.target ? document.querySelector(step.target) : null;

  if (!target) {
    // No element to spotlight — dim the whole screen and center the card.
    backdrop.style.background = 'rgba(20, 14, 6, 0.62)';
    spotlight.style.display = 'none';
    arrow.style.display = 'none';
    tip.style.right = 'auto';
    tip.style.width = '';
    tip.style.left = '50%';
    tip.style.top = '50%';
    tip.style.transform = 'translate(-50%, -50%)';
    return;
  }
  // The spotlight's box-shadow provides the dimming when a target exists.
  backdrop.style.background = 'transparent';
  tip.style.transform = 'none';

  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  requestAnimationFrame(() => {
    const r = target.getBoundingClientRect();
    const VW = window.innerWidth, VH = window.innerHeight;
    const narrow = VW <= 640;
    const pad = 6;
    spotlight.style.display = 'block';
    spotlight.style.left = (r.left - pad) + 'px';
    spotlight.style.top = (r.top - pad) + 'px';
    spotlight.style.width = (r.width + pad * 2) + 'px';
    spotlight.style.height = (r.height + pad * 2) + 'px';

    // Horizontal: on phones, span edge-to-edge so the card can never clip.
    let tipLeft;
    if (narrow) {
      tip.style.left = '12px';
      tip.style.right = '12px';
      tip.style.width = 'auto';
      tipLeft = 12;
    } else {
      tip.style.right = 'auto';
      tip.style.width = '';
      const w = tip.getBoundingClientRect().width;
      tipLeft = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, VW - w - 12));
      tip.style.left = tipLeft + 'px';
    }

    // Vertical: below the target, else above, else pinned to the bottom.
    const tr = tip.getBoundingClientRect();
    const gap = 12;
    let top, side;
    if (VH - r.bottom >= tr.height + gap) { top = r.bottom + gap; side = 'below'; }
    else if (r.top >= tr.height + gap) { top = r.top - gap - tr.height; side = 'above'; }
    else { top = VH - tr.height - 12; side = 'none'; }
    tip.style.top = top + 'px';

    if (side === 'none') {
      arrow.style.display = 'none';
    } else {
      arrow.style.display = 'block';
      arrow.className = 'vp-tour-arrow ' + (side === 'below' ? 'vp-tour-arrow-up' : 'vp-tour-arrow-down');
      const ax = Math.min(Math.max(14, r.left + r.width / 2 - tipLeft - 7), tr.width - 28);
      arrow.style.left = ax + 'px';
      arrow.style.top = side === 'below' ? '-9px' : (tr.height - 1) + 'px';
    }
  });
}

function endTour(startFresh) {
  if (!state) return;
  const { backdrop, spotlight, tip } = state.els;
  window.removeEventListener('resize', state.onResize);
  [backdrop, spotlight, tip].forEach(n => n.remove());
  const demoId = state.demoId;
  state = null;
  markSeen();

  // First run loaded a demo — remove it and land on a fresh trip either way
  // (finished or skipped), so the user starts clean.
  if (demoId) {
    cleanupDemo(demoId);
    ui.view = 'calendar';
    save();
    render();
  }
}

function cleanupDemo(demoId) {
  if (demoId && data.trips[demoId]) {
    markTripDeleted(demoId);
    delete data.trips[demoId];
  }
  if (!data.trips[data.activeTripId]) {
    const ids = Object.keys(data.trips);
    if (ids.length) {
      data.activeTripId = ids[0];
    } else {
      const id = newTripId();
      const today = new Date();
      const end = new Date(today); end.setDate(end.getDate() + 13);
      data.trips[id] = {
        id, name: 'My trip', startDate: isoDate(today), endDate: isoDate(end),
        cards: {}, schedule: {}, library: [], libFilter: 'all', nextId: 1
      };
      data.activeTripId = id;
      markTripDirty(id);
    }
  }
}
