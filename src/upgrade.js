// Upgrade / pricing modal + the contextual "you hit a limit" nudge. This is the
// single place the plan story is told to the user. Checkout lives in billing.js;
// the enforced limits live in entitlements.js (TIERS). Keep this file about
// presentation — human-readable feature copy, not the machine-readable limits.
import { el } from './dom.js';
import { getTier } from './entitlements.js';
import { beginCheckout } from './billing.js';

// Display prices (the source of truth for what to CHARGE is Stripe, resolved
// server-side from tier+interval — these are only for showing the numbers).
const PRICES = {
  plus: { year: 29, month: 3.99 },
  pro:  { year: 79, month: 8.99 },
};

const PLANS = [
  {
    id: 'free', name: 'Explorer', tagline: 'Plan your trips, free forever.',
    features: [
      'Up to 2 trips',
      'Calendar, Places map & itinerary tools',
      'Document vault (up to 5 items)',
      'A taste of the AI helpers',
    ],
  },
  {
    id: 'plus', name: 'Plus', tagline: 'For the regular traveler.',
    features: [
      'Unlimited trips',
      'Unlimited document & loyalty vault',
      'Benefits, credits & expiry reminders',
      'Full points transfer advisor',
      'Generous AI co-planner, guides & journal',
    ],
  },
  {
    id: 'pro', name: 'Pro', tagline: 'For the points maximizer.',
    features: [
      'Everything in Plus',
      'Award search (coming soon)',
      'Highest AI limits',
      'Booking & deadline alerts',
      'Early access to new features',
    ],
  },
];

export function openUpgradeModal({ reason = '', highlight = 'plus' } = {}) {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-upgrade' });
  m.appendChild(el('h3', {}, 'Choose your plan'));
  if (reason) m.appendChild(el('div', { class: 'vp-upgrade-reason' }, reason));

  const tier = getTier();
  let interval = 'year';

  // Annual / monthly toggle (annual default — it is the better deal and the MRR
  // play). Switching re-renders the price labels in place.
  const yearBtn = el('button', { type: 'button', class: 'vp-on' },
    ['Annual ', el('span', { class: 'vp-save-badge' }, 'save ~40%')]);
  const monthBtn = el('button', { type: 'button' }, 'Monthly');
  m.appendChild(el('div', { class: 'vp-upgrade-toggle' }, yearBtn, monthBtn));

  const grid = el('div', { class: 'vp-upgrade-grid' });
  m.appendChild(grid);

  function priceLabel(planId) {
    if (planId === 'free') return 'Free';
    const p = PRICES[planId][interval];
    return interval === 'year' ? `$${p}/yr` : `$${p}/mo`;
  }
  function subLabel(planId) {
    if (planId === 'free') return '';
    if (interval === 'year') return `just $${(PRICES[planId].year / 12).toFixed(2)}/mo, billed yearly`;
    return 'billed monthly';
  }

  function renderGrid() {
    grid.innerHTML = '';
    PLANS.forEach(plan => {
      const isCurrent = plan.id === tier;
      const card = el('div', {
        class: 'vp-plan'
          + (plan.id === highlight ? ' vp-plan-featured' : '')
          + (isCurrent ? ' vp-plan-current' : ''),
      });
      card.appendChild(el('div', { class: 'vp-plan-name' }, plan.name));
      card.appendChild(el('div', { class: 'vp-plan-price' }, priceLabel(plan.id)));
      const sub = subLabel(plan.id);
      if (sub) card.appendChild(el('div', { class: 'vp-plan-sub' }, sub));
      card.appendChild(el('div', { class: 'vp-plan-tagline' }, plan.tagline));
      const ul = el('ul', { class: 'vp-plan-features' });
      plan.features.forEach(f => ul.appendChild(el('li', {}, f)));
      card.appendChild(ul);

      if (isCurrent) {
        card.appendChild(el('div', { class: 'vp-plan-cta vp-plan-cta-current' }, 'Your plan'));
      } else if (plan.id === 'free') {
        card.appendChild(el('div', { class: 'vp-plan-cta vp-plan-cta-muted' }, 'Free forever'));
      } else {
        card.appendChild(el('button', {
          type: 'button', class: 'vp-plan-cta vp-save',
          onclick: () => beginCheckout(plan.id, interval),
        }, `Choose ${plan.name}`));
      }
      grid.appendChild(card);
    });
  }

  function setInterval(next) {
    interval = next;
    yearBtn.classList.toggle('vp-on', next === 'year');
    monthBtn.classList.toggle('vp-on', next === 'month');
    renderGrid();
  }
  yearBtn.addEventListener('click', () => setInterval('year'));
  monthBtn.addEventListener('click', () => setInterval('month'));

  renderGrid();

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { type: 'button', onclick: () => bg.remove() }, 'Maybe later'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}

// Contextual nudge shown when a free user hits a plan limit. `reason` explains
// what they bumped into; `highlight` is the tier to feature (default Plus).
export function requireUpgrade(reason, highlight = 'plus') {
  openUpgradeModal({ reason, highlight });
}
