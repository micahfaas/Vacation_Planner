// Research / places library: a per-trip backlog of researched spots.
import { activeTrip, ui } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { PLACE_CATEGORIES } from './constants.js';
import { addCard } from './cards.js';

// category -> card type, for turning a researched place into a trip card
const CAT_TO_TYPE = {
  restaurant: 'meal', cafe: 'meal', bar: 'meal',
  attraction: 'activity', shop: 'activity', other: 'activity',
  lodging: 'hotel', blog: 'note'
};

function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

function addPlace(place) {
  const t = activeTrip();
  if (!t.places) t.places = [];
  t.places.push(Object.assign({ id: crypto.randomUUID(), category: 'other', name: 'New place' }, place));
  save(); render();
}

function updatePlace(id, patch) {
  const t = activeTrip();
  const p = (t.places || []).find(x => x.id === id);
  if (p) { Object.assign(p, patch); save(); render(); }
}

function removePlace(id) {
  const t = activeTrip();
  t.places = (t.places || []).filter(x => x.id !== id);
  save(); render();
}

// Turn a place into a library card and switch to the calendar to see it.
function makeCardFromPlace(p) {
  const type = CAT_TO_TYPE[p.category] || 'activity';
  const card = {
    type,
    title: p.name || 'Place',
    notes: [p.notes, p.address, p.url, p.website].filter(Boolean).join('\n')
  };
  if (type === 'hotel') card.nights = 1;
  if (type !== 'flight' && type !== 'transit') card.city = '';
  ui.view = 'calendar';
  addCard(card, { kind: 'lib' }); // addCard saves + renders
}

function openPlaceEditor(id) {
  const t = activeTrip();
  const isNew = !id;
  const p = isNew ? { category: 'restaurant' } : Object.assign({}, (t.places || []).find(x => x.id === id));

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, isNew ? 'New place' : 'Edit place'));

  const nameIn = el('input', { type: 'text', value: p.name || '', placeholder: 'e.g. Café Tortoni' });
  const catSel = el('select', {});
  Object.entries(PLACE_CATEGORIES).forEach(([k, v]) => {
    const opt = el('option', { value: k }, v.label);
    if (p.category === k) opt.selected = true;
    catSel.appendChild(opt);
  });
  const urlIn = el('input', { type: 'text', value: p.url || '', placeholder: 'Map link, review, or blog post URL' });
  const siteIn = el('input', { type: 'text', value: p.website || '', placeholder: 'Official website (optional)' });
  const addrIn = el('input', { type: 'text', value: p.address || '', placeholder: 'Address (optional)' });
  const notesIn = el('textarea', { placeholder: 'Why you saved it, hours, what to order…' });
  notesIn.value = p.notes || '';

  m.appendChild(el('label', {}, 'Name'));
  m.appendChild(nameIn);
  m.appendChild(el('label', {}, 'Category'));
  m.appendChild(catSel);
  m.appendChild(el('label', {}, 'Link'));
  m.appendChild(urlIn);
  m.appendChild(el('label', {}, 'Website'));
  m.appendChild(siteIn);
  m.appendChild(el('label', {}, 'Address'));
  m.appendChild(addrIn);
  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const actions = el('div', { class: 'vp-modal-actions' });
  const leftBtns = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    leftBtns.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => { if (confirm('Delete this place?')) { removePlace(id); bg.remove(); } }
    }, 'Delete'));
  }
  actions.appendChild(leftBtns);

  const rightBtns = el('div', { class: 'vp-right' });
  rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  rightBtns.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const out = {
        name: nameIn.value.trim() || 'Untitled place',
        category: catSel.value,
        url: urlIn.value.trim(),
        website: siteIn.value.trim(),
        address: addrIn.value.trim(),
        notes: notesIn.value.trim()
      };
      if (isNew) addPlace(out);
      else updatePlace(id, out);
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(rightBtns);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => nameIn.focus(), 30);
}

function renderPlaceCard(p) {
  const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.other;
  const card = el('div', {
    class: 'vp-place',
    onclick: e => {
      if (e.target.closest('.vp-place-actions') || e.target.closest('a')) return;
      openPlaceEditor(p.id);
    }
  });

  const top = el('div', { class: 'vp-place-top' });
  top.appendChild(el('i', { class: 'ti ' + cat.icon + ' vp-place-icon' }));
  top.appendChild(el('div', { class: 'vp-place-name' }, p.name || 'Untitled place'));
  card.appendChild(top);

  card.appendChild(el('div', { class: 'vp-place-cat' }, cat.label));
  if (p.address) card.appendChild(el('div', { class: 'vp-place-addr' }, p.address));

  if (p.url || p.website) {
    const links = el('div', { class: 'vp-place-links' });
    if (p.url) links.appendChild(el('a',
      { href: normalizeUrl(p.url), target: '_blank', rel: 'noopener', class: 'vp-place-link' },
      el('i', { class: 'ti ti-link' }), 'Link'));
    if (p.website) links.appendChild(el('a',
      { href: normalizeUrl(p.website), target: '_blank', rel: 'noopener', class: 'vp-place-link' },
      el('i', { class: 'ti ti-world' }), 'Website'));
    card.appendChild(links);
  }

  if (p.notes) card.appendChild(el('div', { class: 'vp-place-notes' }, p.notes));

  const actions = el('div', { class: 'vp-place-actions' });
  actions.appendChild(el('button', {
    title: 'Add as a trip card', onclick: e => { e.stopPropagation(); makeCardFromPlace(p); }
  }, '+ card'));
  actions.appendChild(el('button', {
    title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete this place?')) removePlace(p.id); }
  }, '×'));
  card.appendChild(actions);

  return card;
}

// Built by render() when the Places view is active.
export function renderPlacesView() {
  const t = activeTrip();
  const all = t.places || [];
  const panel = el('div', { class: 'vp-places' });

  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Research — places'));
  head.appendChild(el('button', {
    class: 'vp-btn-primary', onclick: () => openPlaceEditor(null)
  }, '+ new place'));
  panel.appendChild(head);

  const filterRow = el('div', { class: 'vp-lib-filter' });
  const cats = [['all', 'all']].concat(Object.entries(PLACE_CATEGORIES).map(([k, v]) => [k, v.label.toLowerCase()]));
  cats.forEach(([k, label]) => {
    filterRow.appendChild(el('button', {
      class: 'vp-chip' + (ui.placeFilter === k ? ' vp-chip-on' : ''),
      onclick: () => { ui.placeFilter = k; render(); }
    }, label));
  });
  panel.appendChild(filterRow);

  const visible = all.filter(p => ui.placeFilter === 'all' || p.category === ui.placeFilter);
  if (visible.length === 0) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      all.length ? 'No places in this category.'
                 : 'No places yet. Click + new place to start your research list.'));
    return panel;
  }

  const grid = el('div', { class: 'vp-places-grid' });
  visible.forEach(p => grid.appendChild(renderPlaceCard(p)));
  panel.appendChild(grid);
  return panel;
}
