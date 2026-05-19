// Resources view: blog links & guides grouped by country/city, plus tickets
// (PDFs / images / access notes) that reuse the Supabase Storage attachments.
import { activeTrip } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { createAttachmentsField, openAttachment } from './attachments.js';

function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

function attachIcon(type) {
  if (/pdf/i.test(type || '')) return 'ti-file-type-pdf';
  if (/^image\//i.test(type || '')) return 'ti-photo';
  return 'ti-file';
}

function resources() {
  const t = activeTrip();
  if (!t.resources) t.resources = { links: [], tickets: [] };
  if (!t.resources.links) t.resources.links = [];
  if (!t.resources.tickets) t.resources.tickets = [];
  return t.resources;
}

// ---------- data ops ----------
function addLink(link) {
  resources().links.push(Object.assign({ id: crypto.randomUUID() }, link));
  save(); render();
}
function updateLink(id, patch) {
  const l = resources().links.find(x => x.id === id);
  if (l) { Object.assign(l, patch); save(); render(); }
}
function removeLink(id) {
  const r = resources();
  r.links = r.links.filter(x => x.id !== id);
  save(); render();
}
function addTicket(ticket) {
  resources().tickets.push(Object.assign({ id: crypto.randomUUID() }, ticket));
  save(); render();
}
function updateTicket(id, patch) {
  const tk = resources().tickets.find(x => x.id === id);
  if (tk) { Object.assign(tk, patch); save(); render(); }
}
function removeTicket(id) {
  const r = resources();
  r.tickets = r.tickets.filter(x => x.id !== id);
  save(); render();
}

// Locations already in use — fed into a datalist so spelling stays consistent.
function locationDatalist() {
  const r = resources();
  const set = new Set();
  r.links.forEach(l => { if (l.location) set.add(l.location.trim()); });
  r.tickets.forEach(t => { if (t.location) set.add(t.location.trim()); });
  const dl = el('datalist', { id: 'vp-res-locations' });
  [...set].sort().forEach(loc => dl.appendChild(el('option', { value: loc })));
  return dl;
}

// ---------- editors ----------
function openLinkEditor(id) {
  const isNew = !id;
  const l = isNew ? {} : Object.assign({}, resources().links.find(x => x.id === id));

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, isNew ? 'New blog link' : 'Edit blog link'));

  const titleIn = el('input', { type: 'text', value: l.title || '', placeholder: 'e.g. 3 days in Lima — food guide' });
  const urlIn = el('input', { type: 'text', value: l.url || '', placeholder: 'Paste the blog or guide URL' });
  const locIn = el('input', { type: 'text', value: l.location || '', placeholder: 'e.g. Peru / Lima', list: 'vp-res-locations' });
  const notesIn = el('textarea', { placeholder: 'Why you saved it, key tips…' });
  notesIn.value = l.notes || '';

  m.appendChild(el('label', {}, 'Title'));
  m.appendChild(titleIn);
  m.appendChild(el('label', {}, 'URL'));
  m.appendChild(urlIn);
  m.appendChild(el('label', {}, 'Country / City'));
  m.appendChild(locIn);
  m.appendChild(locationDatalist());
  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    left.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => { if (confirm('Delete this link?')) { removeLink(id); bg.remove(); } }
    }, 'Delete'));
  }
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const out = {
        title: titleIn.value.trim() || 'Untitled link',
        url: urlIn.value.trim(),
        location: locIn.value.trim(),
        notes: notesIn.value.trim()
      };
      if (isNew) addLink(out);
      else updateLink(id, out);
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => titleIn.focus(), 30);
}

function openTicketEditor(id) {
  const isNew = !id;
  const tk = isNew ? {} : Object.assign({}, resources().tickets.find(x => x.id === id));

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, isNew ? 'New ticket' : 'Edit ticket'));

  const titleIn = el('input', { type: 'text', value: tk.title || '', placeholder: 'e.g. Machu Picchu entry ticket' });
  const locIn = el('input', { type: 'text', value: tk.location || '', placeholder: 'e.g. Peru / Cusco', list: 'vp-res-locations' });
  const accessIn = el('input', { type: 'text', value: tk.accessNote || '', placeholder: 'e.g. In the Omio app · confirmation #ABC123' });
  const notesIn = el('textarea', { placeholder: 'Seat numbers, gate, anything else…' });
  notesIn.value = tk.notes || '';
  const attachField = createAttachmentsField(tk.attachments);

  m.appendChild(el('label', {}, 'Title'));
  m.appendChild(titleIn);
  m.appendChild(el('label', {}, 'Country / City'));
  m.appendChild(locIn);
  m.appendChild(locationDatalist());
  m.appendChild(el('label', {}, 'Where to access it'));
  m.appendChild(accessIn);
  m.appendChild(el('label', {}, 'Files — PDF or image'));
  m.appendChild(attachField.el);
  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    left.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => { if (confirm('Delete this ticket?')) { removeTicket(id); bg.remove(); } }
    }, 'Delete'));
  }
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const out = {
        title: titleIn.value.trim() || 'Untitled ticket',
        location: locIn.value.trim(),
        accessNote: accessIn.value.trim(),
        notes: notesIn.value.trim(),
        attachments: attachField.getValue()
      };
      if (isNew) addTicket(out);
      else updateTicket(id, out);
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => titleIn.focus(), 30);
}

// ---------- rendering ----------
function renderLinkRow(l) {
  const row = el('div', {
    class: 'vp-res-link',
    onclick: e => {
      if (e.target.closest('a') || e.target.closest('.vp-res-link-actions')) return;
      openLinkEditor(l.id);
    }
  });
  const main = el('div', { class: 'vp-res-link-main' });
  const icon = el('i', { class: 'ti ti-article' });
  if (l.url) {
    main.appendChild(el('a', {
      href: normalizeUrl(l.url), target: '_blank', rel: 'noopener', class: 'vp-res-link-title'
    }, icon, el('span', {}, l.title || l.url)));
  } else {
    main.appendChild(el('div', { class: 'vp-res-link-title' }, icon, el('span', {}, l.title || 'Untitled link')));
  }
  if (l.notes) main.appendChild(el('div', { class: 'vp-res-link-notes' }, l.notes));
  row.appendChild(main);

  const actions = el('div', { class: 'vp-res-link-actions' });
  actions.appendChild(el('button', {
    title: 'Delete', 'aria-label': 'Delete link',
    onclick: e => { e.stopPropagation(); if (confirm('Delete this link?')) removeLink(l.id); }
  }, '×'));
  row.appendChild(actions);
  return row;
}

function renderTicketCard(tk) {
  const card = el('div', {
    class: 'vp-place',
    onclick: e => {
      if (e.target.closest('.vp-place-actions') || e.target.closest('.vp-ticket-file')) return;
      openTicketEditor(tk.id);
    }
  });

  const top = el('div', { class: 'vp-place-top' });
  top.appendChild(el('i', { class: 'ti ti-ticket vp-place-icon' }));
  top.appendChild(el('div', { class: 'vp-place-name' }, tk.title || 'Untitled ticket'));
  card.appendChild(top);

  if (tk.location) card.appendChild(el('div', { class: 'vp-place-cat' }, tk.location));
  if (tk.accessNote) {
    card.appendChild(el('div', { class: 'vp-ticket-access' },
      el('strong', {}, 'Access: '), tk.accessNote));
  }

  const files = tk.attachments || [];
  if (files.length) {
    const fl = el('div', { class: 'vp-ticket-files' });
    files.forEach(a => {
      fl.appendChild(el('button', {
        type: 'button', class: 'vp-ticket-file',
        onclick: e => { e.stopPropagation(); openAttachment(a.path); }
      }, el('i', { class: 'ti ' + attachIcon(a.type) }), el('span', {}, a.name)));
    });
    card.appendChild(fl);
  }

  if (tk.notes) card.appendChild(el('div', { class: 'vp-place-notes' }, tk.notes));

  const actions = el('div', { class: 'vp-place-actions' });
  actions.appendChild(el('button', {
    title: 'Delete', 'aria-label': 'Delete ticket',
    onclick: e => { e.stopPropagation(); if (confirm('Delete this ticket?')) removeTicket(tk.id); }
  }, '×'));
  card.appendChild(actions);
  return card;
}

// Built by render() when the Resources view is active.
export function renderResourcesView() {
  const r = resources();
  const panel = el('div', { class: 'vp-places' });

  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Resources'));
  const headBtns = el('div', { class: 'vp-res-headbtns' });
  headBtns.appendChild(el('button', { class: 'vp-btn-primary', onclick: () => openLinkEditor(null) }, '+ blog link'));
  headBtns.appendChild(el('button', { class: 'vp-btn-primary', onclick: () => openTicketEditor(null) }, '+ ticket'));
  head.appendChild(headBtns);
  panel.appendChild(head);

  // --- blog links, grouped by country/city ---
  panel.appendChild(el('div', { class: 'vp-res-section' }, 'Blog links & guides'));
  if (!r.links.length) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      'No links yet. Save blog posts and guides, grouped by country or city.'));
  } else {
    const groups = {};
    r.links.forEach(l => {
      const key = (l.location && l.location.trim()) ? l.location.trim() : 'Unsorted';
      (groups[key] = groups[key] || []).push(l);
    });
    // Real locations sorted A–Z, with "Unsorted" last.
    Object.keys(groups).sort((a, b) => {
      if (a === 'Unsorted') return 1;
      if (b === 'Unsorted') return -1;
      return a.localeCompare(b);
    }).forEach(loc => {
      panel.appendChild(el('div', { class: 'vp-res-group' }, loc));
      const list = el('div', { class: 'vp-res-list' });
      groups[loc].forEach(l => list.appendChild(renderLinkRow(l)));
      panel.appendChild(list);
    });
  }

  // --- tickets & passes ---
  panel.appendChild(el('div', { class: 'vp-res-section' }, 'Tickets & passes'));
  if (!r.tickets.length) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      'No tickets yet. Add a PDF, an image, or a note on where to access each ticket.'));
  } else {
    const grid = el('div', { class: 'vp-places-grid' });
    r.tickets.forEach(tk => grid.appendChild(renderTicketCard(tk)));
    panel.appendChild(grid);
  }

  return panel;
}
