// Trip journal: sends the active trip to the trip-journal Edge Function and
// renders the returned markdown as a styled, editable view. The journal is
// persisted on the trip itself (trip.journal = { markdown, generatedAt,
// edited }) so it travels with exports, shares, and syncs alongside cards.
import { supabase } from './supabase.js';
import { activeTrip } from './state.js';
import { save } from './storage.js';
import { el } from './dom.js';
import { confirmDialog } from './dialog.js';

// ----- Tiny markdown renderer --------------------------------------------
// Covers what the journal prompt produces: h1–h3, paragraphs, **bold**,
// *italic*, bulleted and numbered lists, and basic [text](url) links. Not a
// general-purpose renderer — intentionally scoped to keep the dep surface
// small and predictable.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(s) {
  // Escape first, then re-introduce the few markdown constructs we support.
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^### (.+)/))) { out.push(`<h3>${renderInline(m[1])}</h3>`); i++; continue; }
    if ((m = line.match(/^## (.+)/)))  { out.push(`<h2>${renderInline(m[1])}</h2>`); i++; continue; }
    if ((m = line.match(/^# (.+)/)))   { out.push(`<h1>${renderInline(m[1])}</h1>`); i++; continue; }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Collect consecutive non-blank, non-heading, non-list lines as one paragraph.
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !/^#{1,3} /.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ----- Trip data prep ----------------------------------------------------
// Strip the trip to what the model uses. Mirrors compactTrip in tripcheck.js
// but keeps cost/points fields and notes since they color the narrative.
function compactTrip(t) {
  const cards = Object.values(t.cards || {}).map(c => {
    const out = { id: c.id, type: c.type, title: c.title };
    ['date', 'time', 'city', 'originCity', 'destCity', 'flightNo',
     'depart', 'arrive', 'nights', 'cost', 'pointsCost', 'pointsProgram',
     'notes', 'booked', 'weather'].forEach(k => {
      if (c[k] !== undefined && c[k] !== '' && c[k] !== null) out[k] = c[k];
    });
    return out;
  });
  const schedule = {};
  Object.keys(t.schedule || {}).forEach(d => {
    const ids = (t.schedule[d] || []).filter(Boolean);
    if (ids.length) schedule[d] = ids;
  });
  return {
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    cards,
    schedule
  };
}

// ----- Generation --------------------------------------------------------
export async function generateJournal() {
  const t = activeTrip();
  if (!t) throw new Error('No trip selected.');
  const summary = compactTrip(t);
  let res;
  try {
    res = await supabase.functions.invoke('trip-journal', { body: { trip: summary } });
  } catch {
    throw new Error('Could not reach the journal service.');
  }
  if (res.error) throw new Error('The journal service failed.');
  const data = res.data;
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || 'Journal generation failed.');
  }
  const markdown = String(data.markdown || '');
  t.journal = {
    markdown,
    generatedAt: new Date().toISOString(),
    edited: false
  };
  save();
  return markdown;
}

// ----- View --------------------------------------------------------------
export function renderJournalView() {
  const t = activeTrip();
  const wrap = el('div', { class: 'vp-journal-view' });

  if (!t.startDate || !t.endDate) {
    wrap.appendChild(el('div', { class: 'vp-journal-empty' },
      'Set trip dates first — there isn\'t enough to write about yet.'));
    return wrap;
  }
  const hasCards = Object.keys(t.cards || {}).length > 0;
  if (!hasCards) {
    wrap.appendChild(el('div', { class: 'vp-journal-empty' },
      'Add some cards first — a journal needs something to look back on.'));
    return wrap;
  }

  const j = t.journal || null;

  // Header row: title + actions
  const head = el('div', { class: 'vp-journal-head' });
  head.appendChild(el('h2', {}, 'Journal'));
  const actions = el('div', { class: 'vp-journal-actions' });

  if (!j) {
    const genBtn = el('button', { class: 'vp-btn-primary' }, 'Generate journal');
    const msg = el('span', { class: 'vp-journal-msg' });
    genBtn.addEventListener('click', async () => {
      genBtn.disabled = true;
      msg.textContent = 'Writing your journal — this takes 15–30 seconds…';
      msg.classList.remove('vp-journal-msg-err');
      try {
        await generateJournal();
        rerender();
      } catch (e) {
        msg.textContent = e.message || 'Something went wrong.';
        msg.classList.add('vp-journal-msg-err');
        genBtn.disabled = false;
      }
    });
    actions.appendChild(genBtn);
    actions.appendChild(msg);
  } else {
    const editBtn = el('button', { class: 'vp-btn-ghost' }, 'Edit');
    const regenBtn = el('button', { class: 'vp-btn-ghost' }, 'Regenerate');
    const copyBtn = el('button', { class: 'vp-btn-ghost' }, 'Copy markdown');
    editBtn.addEventListener('click', () => openEditor());
    regenBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Replace the current journal with a fresh AI-generated one? Your edits will be lost.',
        { confirmText: 'Regenerate', danger: true }
      );
      if (!ok) return;
      regenBtn.disabled = true;
      try { await generateJournal(); rerender(); }
      catch { regenBtn.disabled = false; }
    });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(j.markdown).then(() => {
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy markdown'; }, 1500);
      });
    });
    actions.appendChild(editBtn);
    actions.appendChild(regenBtn);
    actions.appendChild(copyBtn);
  }
  head.appendChild(actions);
  wrap.appendChild(head);

  if (j) {
    const meta = el('div', { class: 'vp-journal-meta' });
    const ts = new Date(j.generatedAt);
    const tsLabel = isNaN(ts) ? '' : 'Generated ' + ts.toLocaleString();
    if (tsLabel) meta.appendChild(el('span', {}, tsLabel));
    if (j.edited) meta.appendChild(el('span', { class: 'vp-journal-edited' }, '· edited'));
    wrap.appendChild(meta);

    const body = el('div', { class: 'vp-journal-body' });
    body.innerHTML = renderMarkdown(j.markdown);
    wrap.appendChild(body);
  }

  return wrap;
}

function rerender() {
  // Lazy import to avoid a static cycle with render.js (which imports this).
  import('./render.js').then(({ render }) => render());
}

function openEditor() {
  const t = activeTrip();
  const j = t.journal || { markdown: '' };
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-journal-editor' });
  m.appendChild(el('h3', {}, 'Edit journal'));
  m.appendChild(el('p', { class: 'vp-journal-sub' },
    'Markdown. Use # for the trip title, ## for day headings, blank lines between paragraphs.'));
  const ta = el('textarea', { rows: 22, class: 'vp-journal-textarea' }, j.markdown || '');
  m.appendChild(ta);

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      t.journal = {
        markdown: ta.value,
        generatedAt: j.generatedAt || new Date().toISOString(),
        edited: true
      };
      save();
      bg.remove();
      rerender();
    }
  }, 'Save'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => ta.focus(), 30);
}
