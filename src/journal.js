// Trip journal: sends the active trip to the trip-journal Edge Function and
// renders the returned markdown as a styled, editable view. The journal is
// persisted on the trip itself (trip.journal = { markdown, generatedAt,
// edited }) so it travels with exports, shares, and syncs alongside cards.
import { supabase } from './supabase.js';
import { activeTrip, ui } from './state.js';
import { save } from './storage.js';
import { el } from './dom.js';
import { confirmDialog } from './dialog.js';
import { isoDate, parseISO, addDays, fmtShort } from './dates.js';
import { uploadTripPhoto, dayForPhoto, deleteTripPhoto, signedUrls } from './photos.js';

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

  // Add-photos control (available whether or not a journal exists yet).
  const photoStatus = el('span', { class: 'vp-journal-msg' });
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }
  });
  const addPhotosBtn = el('button', { class: 'vp-btn-ghost' }, 'Add photos');
  addPhotosBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => uploadPhotos([...fileInput.files], addPhotosBtn, photoStatus));
  actions.appendChild(addPhotosBtn);
  actions.appendChild(fileInput);
  actions.appendChild(photoStatus);

  head.appendChild(actions);
  wrap.appendChild(head);

  if (j) {
    const meta = el('div', { class: 'vp-journal-meta' });
    const ts = new Date(j.generatedAt);
    const tsLabel = isNaN(ts) ? '' : 'Generated ' + ts.toLocaleString();
    if (tsLabel) meta.appendChild(el('span', {}, tsLabel));
    if (j.edited) meta.appendChild(el('span', { class: 'vp-journal-edited' }, '· edited'));
    wrap.appendChild(meta);

    const body = buildJournalBody(j.markdown, t);
    wrap.appendChild(body);
    hydratePhotoUrls(body, t);
  } else if ((t.photos || []).length) {
    // Photos uploaded but no journal yet — show them grouped by day with a hint.
    wrap.appendChild(el('p', { class: 'vp-journal-msg' },
      'Photos added. Generate the journal to weave them into the story.'));
    const gallery = buildPhotoGallery(t);
    wrap.appendChild(gallery);
    hydratePhotoUrls(gallery, t);
  }

  return wrap;
}

// ----- Photo upload + rendering ------------------------------------------
function imageFilesOnly(files) {
  return files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|hei[cf])$/i.test(f.name));
}

// Core upload loop: compress + upload each image, assign a day, append to
// trip.photos, persist. onProgress(done, total) is optional. Returns
// { done, failed }. Shared by the in-page button and the PWA share target.
async function addPhotoFiles(files, onProgress) {
  const images = imageFilesOnly(files);
  const t = activeTrip();
  let done = 0, failed = 0;
  for (const file of images) {
    if (onProgress) onProgress(done + 1, images.length);
    try {
      const photo = await uploadTripPhoto(t.id, file);
      photo.day = dayForPhoto(photo.takenAt, t);
      t.photos = t.photos || [];
      t.photos.push(photo);
      done++;
    } catch {
      failed++;
    }
  }
  if (done || failed) save();
  return { done, failed };
}

// In-page "Add photos" button handler.
async function uploadPhotos(files, btn, status) {
  if (!imageFilesOnly(files).length) return;
  btn.disabled = true;
  status.classList.remove('vp-journal-msg-err');
  const { done, failed } = await addPhotoFiles(files, (n, total) => {
    status.textContent = `Uploading ${n} of ${total}…`;
  });
  if (failed) {
    status.textContent = `${done} added, ${failed} failed.`;
    status.classList.add('vp-journal-msg-err');
  }
  btn.disabled = false;
  rerender();
}

// Entry point for photos shared into the app via the PWA share target.
// Switches to the Journal tab and uploads them into the active trip.
export async function ingestSharedPhotos(files) {
  const t = activeTrip();
  if (!t || !imageFilesOnly(files).length) return;
  ui.view = 'journal';
  rerender();
  await addPhotoFiles(files);
  rerender();
}

// List of ISO dates from start to end inclusive.
function daysInRange(start, end) {
  const out = [];
  if (!start || !end) return out;
  let d = parseISO(start);
  const last = parseISO(end);
  while (d <= last) { out.push(isoDate(d)); d = addDays(d, 1); }
  return out;
}

function groupPhotosByDay(photos) {
  const map = new Map();
  (photos || []).forEach(p => {
    const day = p.day || '';
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(p);
  });
  // Within a day, order by capture time when available.
  map.forEach(list => list.sort((a, b) => (a.takenAt || '').localeCompare(b.takenAt || '')));
  return map;
}

// Build the journal body and insert each day's photo strip right under the
// matching day heading. Day headings are mapped positionally to the trip's
// date range (the prompt emits one ## section per day, in order), skipping the
// closing "Looking back" heading. Any photos whose day didn't map land in a
// trailing gallery so nothing is ever hidden.
function buildJournalBody(markdown, trip) {
  const body = el('div', { class: 'vp-journal-body' });
  body.innerHTML = renderMarkdown(markdown);

  const photosByDay = groupPhotosByDay(trip.photos || []);
  const orderedDays = daysInRange(trip.startDate, trip.endDate);
  const placed = new Set();

  const h2s = [...body.querySelectorAll('h2')];
  let dayIdx = 0;
  h2s.forEach(h2 => {
    if (/looking back|reflect/i.test(h2.textContent)) return;
    const day = orderedDays[dayIdx++];
    if (!day) return;
    const photos = photosByDay.get(day);
    if (photos && photos.length) {
      h2.insertAdjacentElement('afterend', buildPhotoStrip(photos, trip));
      placed.add(day);
    }
  });

  // Trailing gallery for any unplaced photos (e.g., journal has fewer day
  // headings than the trip range, or a day's photos didn't map).
  const leftover = [];
  photosByDay.forEach((photos, day) => { if (!placed.has(day)) leftover.push(...photos); });
  if (leftover.length) {
    body.appendChild(el('h2', {}, 'More photos'));
    body.appendChild(buildPhotoStrip(leftover, trip));
  }
  return body;
}

// A gallery of all photos grouped by day, used before a journal exists.
function buildPhotoGallery(trip) {
  const wrap = el('div', { class: 'vp-journal-body' });
  const photosByDay = groupPhotosByDay(trip.photos || []);
  const orderedDays = daysInRange(trip.startDate, trip.endDate);
  const seen = new Set();
  orderedDays.forEach((day, i) => {
    const photos = photosByDay.get(day);
    if (!photos || !photos.length) return;
    seen.add(day);
    wrap.appendChild(el('h2', {}, `Day ${i + 1}: ${fmtShort(parseISO(day))}`));
    wrap.appendChild(buildPhotoStrip(photos, trip));
  });
  const leftover = [];
  photosByDay.forEach((photos, day) => { if (!seen.has(day)) leftover.push(...photos); });
  if (leftover.length) {
    wrap.appendChild(el('h2', {}, 'More photos'));
    wrap.appendChild(buildPhotoStrip(leftover, trip));
  }
  return wrap;
}

// A row of photo thumbnails. Each has a day selector and a delete button.
// Images carry data-path; hydratePhotoUrls fills src with signed URLs.
function buildPhotoStrip(photos, trip) {
  const strip = el('div', { class: 'vp-photo-strip' });
  photos.forEach(p => strip.appendChild(buildPhotoTile(p, trip)));
  return strip;
}

function buildPhotoTile(photo, trip) {
  const tile = el('div', { class: 'vp-photo-tile' });
  const img = el('img', {
    class: 'vp-photo-img', alt: photo.caption || 'Trip photo', loading: 'lazy'
  });
  // A photo with a direct `url` (demo/bundled images) loads as-is; one with a
  // storage `path` gets a signed URL filled in by hydratePhotoUrls.
  if (photo.url) img.src = photo.url;
  else img.setAttribute('data-path', photo.path);
  if (photo.width && photo.height) img.style.aspectRatio = photo.width + ' / ' + photo.height;
  tile.appendChild(img);

  const bar = el('div', { class: 'vp-photo-bar' });
  // Day reassignment
  const daySel = el('select', { class: 'vp-photo-day' });
  daysInRange(trip.startDate, trip.endDate).forEach((day, i) => {
    const opt = el('option', { value: day }, `Day ${i + 1}`);
    if (day === photo.day) opt.selected = true;
    daySel.appendChild(opt);
  });
  daySel.addEventListener('change', () => {
    photo.day = daySel.value;
    save();
    rerender();
  });
  bar.appendChild(daySel);

  const del = el('button', { class: 'vp-photo-del', title: 'Remove photo', 'aria-label': 'Remove photo' }, '×');
  del.addEventListener('click', async () => {
    const ok = await confirmDialog('Remove this photo?', { confirmText: 'Remove', danger: true });
    if (!ok) return;
    const t = activeTrip();
    t.photos = (t.photos || []).filter(x => x.id !== photo.id);
    save();
    rerender();
    if (photo.path) deleteTripPhoto(photo.path); // best-effort storage cleanup (skip for direct-url demo photos)
  });
  bar.appendChild(del);
  tile.appendChild(bar);

  // Click image to open full size. Direct-url photos open as-is; stored photos
  // resolve a short-lived signed URL first.
  img.addEventListener('click', async () => {
    if (photo.url) { window.open(photo.url, '_blank', 'noopener'); return; }
    const tab = window.open('about:blank', '_blank');
    try {
      const map = await signedUrls([photo.path], 300);
      const url = map.get(photo.path);
      if (tab && url) tab.location.href = url;
      else if (tab) tab.close();
    } catch { if (tab) tab.close(); }
  });

  return tile;
}

// Fetch signed URLs for every photo <img data-path> in a container and set src.
async function hydratePhotoUrls(container, trip) {
  const imgs = [...container.querySelectorAll('img[data-path]')];
  if (!imgs.length) return;
  const paths = [...new Set(imgs.map(i => i.getAttribute('data-path')))];
  const map = await signedUrls(paths, 3600);
  imgs.forEach(img => {
    const url = map.get(img.getAttribute('data-path'));
    if (url) img.src = url;
    else img.classList.add('vp-photo-broken');
  });
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
