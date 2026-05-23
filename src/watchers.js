// Booking reminders (#12): reservation-window reminders backed by the
// public.watchers table and delivered via web push (see push.js + the
// watcher-run Edge Function). A reminder fires once, at fire_at.
import { el } from './dom.js';
import { data } from './state.js';
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';
import { isoDate, parseISO, addDays } from './dates.js';
import { alertDialog, confirmDialog } from './dialog.js';
import { pushReady, isSubscribed, enablePush, notificationPermission } from './push.js';

function fmtFire(iso) {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

async function loadWatchers() {
  const { data: rows, error } = await supabase
    .from('watchers').select('*').order('fire_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows || [];
}

export async function openWatchers() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-watchers' });

  m.appendChild(el('h3', {}, 'Booking reminders'));
  m.appendChild(el('div', { class: 'vp-coplan-trip' },
    'Get a nudge when a reservation window opens — restaurants, tours, award space. Delivered as a push notification, even when the app is closed.'));

  // ---- notification enable banner ----
  const banner = el('div', { class: 'vp-watch-banner' });
  m.appendChild(banner);
  async function refreshBanner() {
    banner.innerHTML = '';
    const ready = await pushReady();
    if (!ready) {
      banner.appendChild(el('div', { class: 'vp-watch-note' },
        notificationPermission() === 'unsupported'
          ? 'This browser can’t do push notifications. Reminders will still be saved.'
          : 'Push needs the installed/deployed app — enable it there. (It can’t be turned on from the dev server.)'));
      return;
    }
    if (await isSubscribed()) {
      banner.appendChild(el('div', { class: 'vp-watch-ok' },
        el('i', { class: 'ti ti-bell-check', 'aria-hidden': 'true' }), ' Notifications are on for this device.'));
      return;
    }
    const btn = el('button', { class: 'vp-save' }, 'Enable notifications');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await enablePush(); await refreshBanner(); }
      catch (e) { await alertDialog(e.message || 'Could not enable notifications.'); btn.disabled = false; }
    });
    banner.appendChild(el('div', { class: 'vp-watch-note' }, 'Turn on notifications to receive these reminders:'));
    banner.appendChild(btn);
  }

  // ---- add form ----
  const form = el('div', { class: 'vp-watch-form' });
  const title = el('input', { type: 'text', placeholder: 'What to book — e.g. Reserve El Celler de Can Roca' });
  const dateInput = el('input', { type: 'date', value: isoDate(addDays(new Date(), 1)) });
  const timeInput = el('input', { type: 'time', value: '09:00' });

  const tripSel = el('select', {});
  tripSel.appendChild(el('option', { value: '' }, '— not tied to a trip —'));
  Object.values(data.trips || {}).forEach(tr => {
    tripSel.appendChild(el('option', { value: tr.id }, tr.name || 'Untitled trip'));
  });

  // Quick "N days before this trip starts" helpers.
  const quick = el('div', { class: 'vp-watch-quick' });
  [30, 60, 90].forEach(n => {
    quick.appendChild(el('button', {
      type: 'button', class: 'vp-chip',
      onclick: () => {
        const tr = data.trips[tripSel.value];
        if (!tr || !tr.startDate) { alertDialog('Pick a trip with a start date first.'); return; }
        dateInput.value = isoDate(addDays(parseISO(tr.startDate), -n));
      }
    }, n + ' days before trip'));
  });

  const note = el('input', { type: 'text', placeholder: 'Note (optional)' });
  const url = el('input', { type: 'url', placeholder: 'Link (optional) — e.g. the booking page' });

  form.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'Reminder'), title));
  const when = el('div', { class: 'vp-watch-when' });
  when.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'Remind me on'), dateInput));
  when.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'Time'), timeInput));
  form.appendChild(when);
  form.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'For trip'), tripSel));
  form.appendChild(quick);
  form.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'Note'), note));
  form.appendChild(el('label', { class: 'vp-watch-field' }, el('span', {}, 'Link'), url));

  const addBtn = el('button', { class: 'vp-save' }, '+ Add reminder');
  form.appendChild(addBtn);
  m.appendChild(form);

  // ---- existing list ----
  const listWrap = el('div', { class: 'vp-watch-list' });
  m.appendChild(listWrap);

  async function refreshList() {
    listWrap.innerHTML = '';
    let rows;
    try { rows = await loadWatchers(); }
    catch (e) {
      listWrap.appendChild(el('div', { class: 'vp-coplan-err' },
        'Could not load reminders — ' + e.message + ' (has supabase/watchers.sql been run?)'));
      return;
    }
    if (!rows.length) {
      listWrap.appendChild(el('div', { class: 'vp-watch-empty' }, 'No reminders yet.'));
      return;
    }
    rows.forEach(w => {
      const past = new Date(w.fire_at).getTime() < Date.now();
      const row = el('div', { class: 'vp-watch-item' });
      const left = el('div', { class: 'vp-watch-item-main' });
      left.appendChild(el('div', { class: 'vp-watch-item-title' }, w.title));
      const metaBits = [fmtFire(w.fire_at)];
      if (w.status === 'sent') metaBits.push('sent');
      else if (past) metaBits.push('overdue');
      const meta = el('div', { class: 'vp-watch-item-meta' }, metaBits.join(' · '));
      left.appendChild(meta);
      if (w.note) left.appendChild(el('div', { class: 'vp-watch-item-note' }, w.note));
      if (w.url) left.appendChild(el('a', {
        href: w.url, target: '_blank', rel: 'noopener noreferrer', class: 'vp-coplan-link'
      }, [el('i', { class: 'ti ti-external-link' }), 'Open link']));
      row.appendChild(left);
      row.appendChild(el('button', {
        type: 'button', class: 'vp-balance-rm', title: 'Delete reminder',
        onclick: async () => {
          const ok = await confirmDialog('Delete this reminder?', { danger: true, confirmText: 'Delete' });
          if (!ok) return;
          await supabase.from('watchers').delete().eq('id', w.id);
          refreshList();
        }
      }, '×'));
      listWrap.appendChild(row);
    });
  }

  addBtn.addEventListener('click', async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    if (!dateInput.value) { dateInput.focus(); return; }
    const fireAt = new Date(dateInput.value + 'T' + (timeInput.value || '09:00'));
    if (isNaN(fireAt.getTime())) { await alertDialog('That date/time is invalid.'); return; }
    addBtn.disabled = true;
    const { error } = await supabase.from('watchers').insert({
      user_id: getUserId(),
      type: 'reservation',
      title: t,
      note: note.value.trim(),
      url: url.value.trim(),
      trip_id: tripSel.value || '',
      fire_at: fireAt.toISOString(),
    });
    addBtn.disabled = false;
    if (error) { await alertDialog('Could not save — ' + error.message + ' (has supabase/watchers.sql been run?)'); return; }
    title.value = ''; note.value = ''; url.value = '';
    refreshList();
  });

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  refreshBanner();
  refreshList();
}
