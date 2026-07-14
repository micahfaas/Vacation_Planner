// Trips menu: switch, rename, delete, create.
import { data } from './state.js';
import { el } from './dom.js';
import { save, markTripDirty, markTripDeleted, newTripId } from './storage.js';
import { render } from './render.js';
import { fmtShort, parseISO, isoDate } from './dates.js';
import { openShareDialog } from './share.js';
import { confirmDialog, promptDialog } from './dialog.js';
import { loadDemoTrip } from './demo.js';
import { openTripIdeas } from './tripideas.js';
import { gatingActive, canAdd, limitFor } from './entitlements.js';
import { requireUpgrade } from './upgrade.js';
import { track } from './analytics.js';

export function openTripsMenu() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Trips'));

  const firstActiveId = () =>
    Object.keys(data.trips).find(id => !data.trips[id].archived)
    || Object.keys(data.trips)[0] || null;

  function tripRow(tr, isArchived) {
    const item = el('div', {
      class: 'vp-trip-item' + (tr.id === data.activeTripId ? ' vp-trip-active' : '')
        + (isArchived ? ' vp-trip-archived' : ''),
      onclick: e => {
        if (isArchived || e.target.closest('.vp-trip-item-actions')) return;
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
    if (!isArchived) {
      itemActions.appendChild(el('button', {
        title: 'Share a read-only link', 'aria-label': 'Share a read-only link',
        onclick: e => { e.stopPropagation(); openShareDialog(tr); }
      }, el('i', { class: 'ti ti-share', 'aria-hidden': 'true' })));
      itemActions.appendChild(el('button', {
        title: 'Rename', 'aria-label': 'Rename trip',
        onclick: async e => {
          e.stopPropagation();
          const name = await promptDialog('Trip name', tr.name, { title: 'Rename trip' });
          if (name && name.trim()) { tr.name = name.trim(); markTripDirty(tr.id); save(); openTripsMenu(); bg.remove(); }
        }
      }, el('i', { class: 'ti ti-edit' })));
      // Archive (instead of delete) — keeps the trip and all its places, hidden.
      if (Object.values(data.trips).filter(t => !t.archived).length > 1) {
        itemActions.appendChild(el('button', {
          title: 'Archive', 'aria-label': 'Archive trip',
          onclick: e => {
            e.stopPropagation();
            tr.archived = true;
            markTripDirty(tr.id);
            if (data.activeTripId === tr.id) data.activeTripId = firstActiveId();
            save(); render(); openTripsMenu(); bg.remove();
          }
        }, el('i', { class: 'ti ti-archive' })));
      }
    } else {
      itemActions.appendChild(el('button', {
        title: 'Restore', 'aria-label': 'Restore trip',
        onclick: e => {
          e.stopPropagation();
          tr.archived = false;
          markTripDirty(tr.id);
          save(); render(); openTripsMenu(); bg.remove();
        }
      }, el('i', { class: 'ti ti-archive-off' })));
      itemActions.appendChild(el('button', {
        title: 'Delete permanently', 'aria-label': 'Delete trip permanently',
        onclick: e => {
          e.stopPropagation();
          confirmDialog('Permanently delete “' + tr.name + '” and all its cards? This cannot be undone.',
            { danger: true, confirmText: 'Delete forever' }).then(ok => {
            if (!ok) return;
            if ((tr.photos || []).length) import('./photos.js').then(m => m.deleteAllTripPhotos(tr));
            markTripDeleted(tr.id);
            delete data.trips[tr.id];
            if (data.activeTripId === tr.id) data.activeTripId = firstActiveId();
            save(); render(); openTripsMenu(); bg.remove();
          });
        }
      }, el('i', { class: 'ti ti-trash' })));
    }
    item.appendChild(itemActions);
    return item;
  }

  const list = el('div', { class: 'vp-trips-list' });
  Object.values(data.trips).filter(t => !t.archived).forEach(tr => list.appendChild(tripRow(tr, false)));
  m.appendChild(list);

  const archived = Object.values(data.trips).filter(t => t.archived);
  if (archived.length) {
    m.appendChild(el('div', { class: 'vp-trips-archived-head' }, 'Archived'));
    const archList = el('div', { class: 'vp-trips-list' });
    archived.forEach(tr => archList.appendChild(tripRow(tr, true)));
    m.appendChild(archList);
  }

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', {});
  left.appendChild(el('button', {
    class: 'vp-trips-ideas',
    title: 'Get destination ideas based on your points and dates',
    onclick: () => { bg.remove(); openTripIdeas(); }
  }, [el('i', { class: 'ti ti-sparkles', 'aria-hidden': 'true' }), ' Trip ideas']));
  left.appendChild(el('button', {
    title: 'Load a 10-day Spain trip with rich sample data',
    onclick: async () => {
      const ok = await confirmDialog(
        'Add a 10-day Spain demo trip with flights, hotels, activities, and saved places? ' +
        'You can edit or delete it like any other trip.',
        { title: 'Load demo', confirmText: 'Load demo' });
      if (!ok) return;
      loadDemoTrip();
      bg.remove();
    }
  }, 'Load demo'));
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: async () => {
      const activeCount = Object.values(data.trips).filter(t => !t.archived).length;
      if (gatingActive() && !canAdd('trips', activeCount)) {
        bg.remove();
        requireUpgrade('The free plan includes up to ' + limitFor('trips') +
          ' trips. Upgrade to Plus for unlimited trips.', 'plus');
        return;
      }
      const name = await promptDialog('Name for new trip', 'New trip', { title: 'New trip' });
      if (!name || !name.trim()) return;
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
      track('Trip Created');
    }
  }, '+ new trip'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
