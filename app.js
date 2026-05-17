(function () {
  'use strict';

  // ---------- types ----------
  const TYPES = {
    flight:   { label: 'Flight',    icon: 'ti-plane',           color: '#185FA5', bg: '#E6F1FB', text: '#0C447C', darkBg: '#0c447c', darkText: '#b5d4f4' },
    hotel:    { label: 'Hotel',     icon: 'ti-bed',             color: '#534AB7', bg: '#EEEDFE', text: '#3C3489', darkBg: '#3c3489', darkText: '#cecbf6' },
    activity: { label: 'Activity',  icon: 'ti-camera',          color: '#0F6E56', bg: '#E1F5EE', text: '#085041', darkBg: '#085041', darkText: '#9fe1cb' },
    transit:  { label: 'Transit',   icon: 'ti-bus',             color: '#BA7517', bg: '#FAEEDA', text: '#854F0B', darkBg: '#854f0b', darkText: '#fac775' },
    meal:     { label: 'Meal',      icon: 'ti-tools-kitchen-2', color: '#993556', bg: '#FBEAF0', text: '#72243E', darkBg: '#72243e', darkText: '#f4c0d1' },
    note:     { label: 'Note',      icon: 'ti-note',            color: '#5F5E5A', bg: '#F1EFE8', text: '#2C2C2A', darkBg: '#2c2c2a', darkText: '#d3d1c7' }
  };

  const STORAGE_KEY = 'vacation_planner_v1';
  const DARK = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  // ---------- state ----------
  // Multi-trip support. data = { activeTripId, trips: { id: trip } }
  // trip = { id, name, startDate, endDate, cards: {}, schedule: {}, library: [], nextId }
  let data = {
    activeTripId: null,
    trips: {}
  };

  function activeTrip() { return data.trips[data.activeTripId]; }

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.trips) {
          data = parsed;
        } else if (parsed && parsed.cards) {
          // legacy single-trip shape, migrate
          const id = 't' + Date.now();
          data = {
            activeTripId: id,
            trips: { [id]: Object.assign({ id, name: 'My trip', nextId: 1 }, parsed) }
          };
        }
      }
    } catch (e) {
      console.warn('Load failed', e);
    }
    if (!data.activeTripId || !data.trips[data.activeTripId]) {
      const id = 't' + Date.now();
      const today = new Date();
      const end = new Date(today); end.setDate(end.getDate() + 13);
      data = {
        activeTripId: id,
        trips: {
          [id]: {
            id, name: 'My trip',
            startDate: isoDate(today), endDate: isoDate(end),
            cards: {}, schedule: {}, library: [],
            libFilter: 'all',
            nextId: 1
          }
        }
      };
    }
    // ensure each trip has all required fields
    Object.values(data.trips).forEach(t => {
      if (!t.cards) t.cards = {};
      if (!t.schedule) t.schedule = {};
      if (!t.library) t.library = [];
      if (!t.libFilter) t.libFilter = 'all';
      if (!t.nextId) t.nextId = 1;
    });
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  // ---------- date utils ----------
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function fmtShort(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtMin(min) {
    if (!min || min < 0) return '';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h > 0 ? (h + 'h' + (m ? ' ' + m + 'm' : '')) : (m + 'm');
  }
  function timeToMin(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  // ---------- card ops ----------
  function newId() {
    const t = activeTrip();
    return 'c' + (t.nextId++);
  }
  function addCard(card, target) {
    const t = activeTrip();
    const id = newId();
    t.cards[id] = Object.assign({ id, type: 'note', title: 'New card' }, card);
    if (target && target.kind === 'day') {
      t.schedule[target.date] = t.schedule[target.date] || [];
      t.schedule[target.date].push(id);
    } else {
      t.library.push(id);
    }
    save(); render();
  }
  function removeCard(id) {
    const t = activeTrip();
    delete t.cards[id];
    t.library = t.library.filter(x => x !== id);
    Object.keys(t.schedule).forEach(d => {
      t.schedule[d] = t.schedule[d].filter(x => x !== id);
      if (t.schedule[d].length === 0) delete t.schedule[d];
    });
    save(); render();
  }
  function duplicateCard(id) {
    const t = activeTrip();
    const src = t.cards[id]; if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    copy.title = src.title + ' (copy)';
    addCard(copy, { kind: 'lib' });
  }
  function moveCard(id, target) {
    const t = activeTrip();
    t.library = t.library.filter(x => x !== id);
    Object.keys(t.schedule).forEach(d => {
      t.schedule[d] = t.schedule[d].filter(x => x !== id);
      if (t.schedule[d].length === 0) delete t.schedule[d];
    });
    if (target.kind === 'day') {
      t.schedule[target.date] = t.schedule[target.date] || [];
      t.schedule[target.date].push(id);
    } else {
      t.library.push(id);
    }
    save(); render();
  }

  // ---------- derived ----------
  function getDays() {
    const t = activeTrip();
    const out = [];
    if (!t.startDate || !t.endDate) return out;
    const start = parseISO(t.startDate);
    const end = parseISO(t.endDate);
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }
  function getGridDays() {
    const days = getDays();
    if (days.length === 0) return [];
    const first = days[0]; const last = days[days.length - 1];
    const padBefore = first.getDay();
    const padAfter = 6 - last.getDay();
    const out = [];
    for (let i = padBefore; i > 0; i--) out.push({ d: addDays(first, -i), out: true });
    days.forEach(d => out.push({ d, out: false }));
    for (let i = 1; i <= padAfter; i++) out.push({ d: addDays(last, i), out: true });
    return out;
  }

  function computeStats() {
    const t = activeTrip();
    const days = getDays();
    const totalDays = days.length;
    const filled = days.filter(d => (t.schedule[isoDate(d)] || []).length > 0).length;
    const cityNights = {};
    let totalFlightMin = 0, totalTransitMin = 0;
    days.forEach(d => {
      const ids = t.schedule[isoDate(d)] || [];
      ids.forEach(id => {
        const c = t.cards[id]; if (!c) return;
        if (c.type === 'hotel' && c.city) {
          cityNights[c.city] = (cityNights[c.city] || 0) + (parseInt(c.nights) || 1);
        }
        if ((c.type === 'flight' || c.type === 'transit') && c.depart && c.arrive) {
          const m = (new Date(c.arrive) - new Date(c.depart)) / 60000;
          if (m > 0 && m < 60 * 48) {
            if (c.type === 'flight') totalFlightMin += m;
            else totalTransitMin += m;
          }
        }
      });
    });
    return { totalDays, filled, unaccounted: totalDays - filled, cityNights, totalFlightMin, totalTransitMin };
  }

  function getConflicts() {
    const t = activeTrip();
    const out = {};
    Object.keys(t.schedule).forEach(date => {
      const ids = t.schedule[date];
      const intervals = [];
      ids.forEach(id => {
        const c = t.cards[id]; if (!c) return;
        if (c.depart && c.arrive) {
          intervals.push([new Date(c.depart).getTime(), new Date(c.arrive).getTime(), c]);
        } else if (c.time) {
          const a = parseISO(date).getTime() + timeToMin(c.time) * 60000;
          intervals.push([a, a + 60 * 60000, c]);
        }
      });
      let conflict = false;
      for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
          if (intervals[i][0] < intervals[j][1] && intervals[j][0] < intervals[i][1]) conflict = true;
        }
      }
      if (conflict) out[date] = true;
    });
    return out;
  }

  // ---------- DOM helpers ----------
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (props[k] === true) e.setAttribute(k, '');
      else if (props[k] !== false && props[k] != null) e.setAttribute(k, props[k]);
    });
    children.flat().forEach(c => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }

  // ---------- render ----------
  const root = document.getElementById('vp-root');

  function render() {
    const t = activeTrip();
    document.getElementById('vp-trip-name').textContent = t.name;
    root.innerHTML = '';

    // toolbar
    const tb = el('div', { class: 'vp-toolbar' });
    tb.appendChild(el('label', {}, 'Trip dates'));
    const sd = el('input', { type: 'date', value: t.startDate || '' });
    sd.addEventListener('change', e => {
      t.startDate = e.target.value;
      if (t.endDate < t.startDate) t.endDate = t.startDate;
      save(); render();
    });
    tb.appendChild(sd);
    tb.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--text-2)' } }, 'to'));
    const ed = el('input', { type: 'date', value: t.endDate || '' });
    ed.addEventListener('change', e => { t.endDate = e.target.value; save(); render(); });
    tb.appendChild(ed);
    tb.appendChild(el('button', { class: 'vp-btn-primary', onclick: () => openEditor(null, { kind: 'lib' }) }, '+ new card'));
    root.appendChild(tb);

    if (!t.startDate || !t.endDate || t.endDate < t.startDate) {
      root.appendChild(el('div', { class: 'vp-empty-cal' }, 'Pick a start and end date to begin.'));
      return;
    }

    const layout = el('div', { class: 'vp-layout' });

    // calendar
    const calCol = el('div', {});
    const calHead = el('div', { class: 'vp-cal-head' });
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(d => calHead.appendChild(el('div', {}, d)));
    calCol.appendChild(calHead);

    const cal = el('div', { class: 'vp-cal' });
    const conflicts = getConflicts();
    getGridDays().forEach(({ d, out }) => {
      const iso = isoDate(d);
      const day = el('div', {
        class: 'vp-day' + (out ? ' vp-out' : '') + (conflicts[iso] && !out ? ' vp-conflict' : ''),
        'data-date': iso
      });
      const headRow = el('div', { class: 'vp-day-num' });
      const lbl = d.getDate() === 1 || iso === t.startDate ? fmtShort(d) : String(d.getDate());
      headRow.appendChild(el('span', {}, lbl));
      if (conflicts[iso] && !out) {
        headRow.appendChild(el('i', { class: 'ti ti-alert-triangle vp-conflict-ico', title: 'Time overlap on this day' }));
      }
      day.appendChild(headRow);

      if (!out) {
        attachDropZone(day, { kind: 'day', date: iso });
        (t.schedule[iso] || []).forEach(id => day.appendChild(renderCard(id)));
        day.appendChild(el('button', { class: 'vp-add-btn', onclick: () => openEditor(null, { kind: 'day', date: iso }) }, '+'));
      }
      cal.appendChild(day);
    });
    calCol.appendChild(cal);
    layout.appendChild(calCol);

    // sidebar
    const side = el('div', { class: 'vp-side' });
    side.appendChild(libraryPanel());
    side.appendChild(statsPanel());
    layout.appendChild(side);

    root.appendChild(layout);
  }

  function libraryPanel() {
    const t = activeTrip();
    const panel = el('div', { class: 'vp-panel' });
    panel.appendChild(el('h3', {}, 'Card library'));

    const filterRow = el('div', { class: 'vp-lib-filter' });
    const filters = [['all', 'all']].concat(Object.entries(TYPES).map(([k, v]) => [k, v.label.toLowerCase()]));
    filters.forEach(([k, label]) => {
      filterRow.appendChild(el('button', {
        class: 'vp-chip' + (t.libFilter === k ? ' vp-chip-on' : ''),
        onclick: () => { t.libFilter = k; save(); render(); }
      }, label));
    });
    panel.appendChild(filterRow);

    const lib = el('div', { class: 'vp-lib' });
    attachDropZone(lib, { kind: 'lib' });
    const visible = t.library.filter(id => t.cards[id] && (t.libFilter === 'all' || t.cards[id].type === t.libFilter));
    if (visible.length === 0) {
      lib.appendChild(el('div', { class: 'vp-lib-empty' },
        t.library.length ? 'No cards in this category.' : 'Drag cards here to stash them, or click + new card to start.'));
    } else {
      visible.forEach(id => lib.appendChild(renderCard(id)));
    }
    panel.appendChild(lib);
    return panel;
  }

  function statsPanel() {
    const panel = el('div', { class: 'vp-panel vp-stats' });
    panel.appendChild(el('h3', {}, 'Trip math'));
    const s = computeStats();
    panel.appendChild(statRow('Total days', String(s.totalDays)));
    panel.appendChild(statRow('Days planned', String(s.filled)));
    panel.appendChild(statRow('Open days', String(s.unaccounted)));
    if (Object.keys(s.cityNights).length) {
      panel.appendChild(el('div', { style: { marginTop: '10px', fontSize: '11px', color: 'var(--text-2)' } }, 'Nights per city'));
      Object.entries(s.cityNights).forEach(([city, n]) => {
        const r = el('div', { class: 'vp-stat-sub' });
        r.appendChild(el('span', {}, city));
        r.appendChild(el('span', {}, n + (n === 1 ? ' night' : ' nights')));
        panel.appendChild(r);
      });
    }
    if (s.totalFlightMin > 0) panel.appendChild(statRow('Flight time', fmtMin(s.totalFlightMin)));
    if (s.totalTransitMin > 0) panel.appendChild(statRow('Transit time', fmtMin(s.totalTransitMin)));
    return panel;
  }

  function statRow(label, val) {
    const r = el('div', { class: 'vp-stat-row' });
    r.appendChild(el('span', {}, label));
    r.appendChild(el('strong', {}, val));
    return r;
  }

  function renderCard(id) {
    const t = activeTrip();
    const c = t.cards[id]; if (!c) return el('span');
    const tp = TYPES[c.type] || TYPES.note;
    const bg = DARK ? tp.darkBg : tp.bg;
    const fg = DARK ? tp.darkText : tp.text;
    const card = el('div', {
      class: 'vp-card',
      draggable: 'true',
      'data-id': id,
      style: { background: bg, borderLeftColor: tp.color, color: fg },
      onclick: e => { if (e.target.closest('.vp-card-actions')) return; openEditor(id); }
    });
    const title = el('div', { class: 'vp-card-title' });
    title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
    title.appendChild(el('span', {}, c.title || tp.label));
    card.appendChild(title);
    const meta = cardMeta(c);
    if (meta) card.appendChild(el('div', { class: 'vp-card-meta' }, meta));

    const actions = el('div', { class: 'vp-card-actions' });
    actions.appendChild(el('button', { title: 'Duplicate', onclick: e => { e.stopPropagation(); duplicateCard(id); } }, '⧉'));
    actions.appendChild(el('button', { title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete this card?')) removeCard(id); } }, '×'));
    card.appendChild(actions);

    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('vp-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('vp-dragging'));
    return card;
  }

  function cardMeta(c) {
    const bits = [];
    if (c.city) bits.push(c.city);
    if (c.type === 'flight' && c.flightNo) bits.push(c.flightNo);
    if (c.time) bits.push(c.time);
    if (c.depart && c.arrive) {
      const dt = c.depart.slice(11, 16), at = c.arrive.slice(11, 16);
      if (dt && at) bits.push(dt + ' → ' + at);
    }
    if (c.type === 'hotel' && c.nights) bits.push(c.nights + (c.nights == 1 ? ' night' : ' nights'));
    return bits.join(' · ');
  }

  function attachDropZone(zone, target) {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('vp-drop');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('vp-drop');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('vp-drop');
      const id = e.dataTransfer.getData('text/plain');
      if (id) moveCard(id, target);
    });
  }

  // ---------- editor modal ----------
  function openEditor(id, addTarget) {
    const t = activeTrip();
    const isNew = !id;
    const c = isNew ? { type: 'flight', title: '' } : Object.assign({}, t.cards[id]);

    const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
    const m = el('div', { class: 'vp-modal' });
    m.appendChild(el('h3', {}, isNew ? 'New card' : 'Edit card'));

    const typeSel = el('select', {});
    Object.entries(TYPES).forEach(([k, v]) => {
      const opt = el('option', { value: k }, v.label);
      if (c.type === k) opt.selected = true;
      typeSel.appendChild(opt);
    });
    m.appendChild(el('label', {}, 'Type'));
    m.appendChild(typeSel);

    const titleIn = el('input', { type: 'text', value: c.title || '', placeholder: 'e.g. Fly to Buenos Aires' });
    m.appendChild(el('label', {}, 'Title'));
    m.appendChild(titleIn);

    const cityIn = el('input', { type: 'text', value: c.city || '', placeholder: 'e.g. Buenos Aires' });
    m.appendChild(el('label', {}, 'City'));
    m.appendChild(cityIn);

    const flightNoIn = el('input', { type: 'text', value: c.flightNo || '', placeholder: 'AA123' });
    const departIn = el('input', { type: 'datetime-local', value: c.depart || '' });
    const arriveIn = el('input', { type: 'datetime-local', value: c.arrive || '' });
    const timeIn = el('input', { type: 'time', value: c.time || '' });
    const nightsIn = el('input', { type: 'number', min: '1', value: c.nights || 1 });
    const notesIn = el('textarea', { placeholder: 'Confirmation #, address, links, anything else…' });
    notesIn.value = c.notes || '';

    const dynamic = el('div', {});
    m.appendChild(dynamic);

    function renderDynamic() {
      dynamic.innerHTML = '';
      const tp = typeSel.value;
      if (tp === 'flight' || tp === 'transit') {
        dynamic.appendChild(el('label', {}, tp === 'flight' ? 'Flight number' : 'Carrier / reference'));
        dynamic.appendChild(flightNoIn);
        dynamic.appendChild(el('label', {}, 'Depart'));
        dynamic.appendChild(departIn);
        dynamic.appendChild(el('label', {}, 'Arrive'));
        dynamic.appendChild(arriveIn);
      } else if (tp === 'hotel') {
        dynamic.appendChild(el('label', {}, 'Nights'));
        dynamic.appendChild(nightsIn);
      } else if (tp === 'activity' || tp === 'meal') {
        dynamic.appendChild(el('label', {}, 'Time'));
        dynamic.appendChild(timeIn);
      }
    }
    renderDynamic();
    typeSel.addEventListener('change', renderDynamic);

    m.appendChild(el('label', {}, 'Notes'));
    m.appendChild(notesIn);

    const actions = el('div', { class: 'vp-modal-actions' });
    const leftBtns = el('div', {});
    if (!isNew) {
      leftBtns.appendChild(el('button', {
        class: 'vp-delete',
        onclick: () => { if (confirm('Delete this card?')) { removeCard(id); bg.remove(); } }
      }, 'Delete'));
    }
    actions.appendChild(leftBtns);

    const rightBtns = el('div', { class: 'vp-right' });
    rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
    rightBtns.appendChild(el('button', {
      class: 'vp-save',
      onclick: () => {
        const out = {
          type: typeSel.value,
          title: titleIn.value.trim() || TYPES[typeSel.value].label,
          city: cityIn.value.trim(),
          notes: notesIn.value.trim()
        };
        const tp = typeSel.value;
        if (tp === 'flight' || tp === 'transit') {
          out.flightNo = flightNoIn.value.trim();
          out.depart = departIn.value;
          out.arrive = arriveIn.value;
        }
        if (tp === 'hotel') out.nights = parseInt(nightsIn.value) || 1;
        if (tp === 'activity' || tp === 'meal') out.time = timeIn.value;

        if (isNew) {
          addCard(out, addTarget || { kind: 'lib' });
        } else {
          Object.assign(t.cards[id], out);
          // clean stale fields that don't apply to new type
          if (out.type !== 'flight' && out.type !== 'transit') {
            delete t.cards[id].flightNo;
            delete t.cards[id].depart;
            delete t.cards[id].arrive;
          }
          if (out.type !== 'hotel') delete t.cards[id].nights;
          if (out.type !== 'activity' && out.type !== 'meal') delete t.cards[id].time;
          save(); render();
        }
        bg.remove();
      }
    }, 'Save'));
    actions.appendChild(rightBtns);
    m.appendChild(actions);

    bg.appendChild(m);
    document.body.appendChild(bg);
    setTimeout(() => titleIn.focus(), 30);
  }

  // ---------- trips menu ----------
  function openTripsMenu() {
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
        title: 'Rename',
        onclick: e => {
          e.stopPropagation();
          const name = prompt('Trip name', tr.name);
          if (name) { tr.name = name.trim(); save(); openTripsMenu(); bg.remove(); }
        }
      }, el('i', { class: 'ti ti-edit' })));
      if (Object.keys(data.trips).length > 1) {
        itemActions.appendChild(el('button', {
          title: 'Delete',
          onclick: e => {
            e.stopPropagation();
            if (confirm('Delete trip "' + tr.name + '" and all its cards?')) {
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
        const id = 't' + Date.now();
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

  // ---------- import / export ----------
  function exportJSON() {
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
  function importJSON(file) {
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
        data.activeTripId = id;
        save(); render();
      } catch (e) {
        alert('Could not read that file: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- wire up header ----------
  document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
  document.getElementById('vp-export-btn').addEventListener('click', exportJSON);
  document.getElementById('vp-import-btn').addEventListener('click', () => document.getElementById('vp-import-file').click());
  document.getElementById('vp-import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  // ---------- boot ----------
  load();
  render();
})();
