// Trips menu: switch, rename, delete, create.
import { data } from './state.js';
import { el } from './dom.js';
import { save, markTripDirty, markTripDeleted, newTripId } from './storage.js';
import { render } from './render.js';
import { fmtShort, parseISO, isoDate } from './dates.js';
import { openShareDialog } from './share.js';

export function openTripsMenu() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Trips'));

  const list = el('div', { class: 'vp-trips-list' });
  Object.values(data.trips).forEach(tr => {
    const item = el('div', {
      class: 'vp-trip-item' + (tr.id === data.activeTripId ? ' vp-trip-active' : ''),
      onclick: e => {
        if (e.target.closest('.vp-trip-item-actions')) return;
        data.activeTripId = tr.id;
        save(); render(); bg.remove();
      }
    });
    const left = el('div', {});
    left.appendChild(el('div', { style: { fontWeight: 500 } }, tr.name));
    const days = tr.startDate && tr.endDate
      ? fmtShort(parseISO(tr.startDate)) + ' – ' + fmtShort(parseISO(tr.endDate))
      : 'no dates';
    left.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)' } }, days));
    item.appendChild(left);

    const itemActions = el('div', { class: 'vp-trip-item-actions' });
    itemActions.appendChild(el('button', {
      title: 'Share a read-only link', 'aria-label': 'Share a read-only link',
      onclick: e => { e.stopPropagation(); openShareDialog(tr); }
    }, el('i', { class: 'ti ti-share', 'aria-hidden': 'true' })));
    itemActions.appendChild(el('button', {
      title: 'Rename', 'aria-label': 'Rename trip',
      onclick: e => {
        e.stopPropagation();
        const name = prompt('Trip name', tr.name);
        if (name) { tr.name = name.trim(); markTripDirty(tr.id); save(); openTripsMenu(); bg.remove(); }
      }
    }, el('i', { class: 'ti ti-edit' })));
    if (Object.keys(data.trips).length > 1) {
      itemActions.appendChild(el('button', {
        title: 'Delete', 'aria-label': 'Delete trip',
        onclick: e => {
          e.stopPropagation();
          if (confirm('Delete trip "' + tr.name + '" and all its cards?')) {
            markTripDeleted(tr.id);
            delete data.trips[tr.id];
            if (data.activeTripId === tr.id) {
              data.activeTripId = Object.keys(data.trips)[0];
            }
            save(); render(); bg.remove();
          }
        }
      }, el('i', { class: 'ti ti-trash' })));
    }
    item.appendChild(itemActions);
    list.appendChild(item);
  });
  m.appendChild(list);

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const name = prompt('Name for new trip', 'New trip');
      if (!name) return;
      const id = newTripId();
      const today = new Date();
      const end = new Date(today); end.setDate(end.getDate() + 13);
      data.trips[id] = {
        id, name: name.trim(),
        startDate: isoDate(today), endDate: isoDate(end),
        cards: {}, schedule: {}, library: [],
        libFilter: 'all', nextId: 1
      };
      data.activeTripId = id;
      save(); render(); bg.remove();
    }
  }, '+ new trip'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
