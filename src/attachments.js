// Card file attachments, stored in the private Supabase Storage bucket.
import { el } from './dom.js';
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';
import { alertDialog } from './dialog.js';

const BUCKET = 'attachments';
const MAX_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes) {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function uploadFile(file) {
  const uid = getUserId();
  if (!uid) throw new Error('Not signed in');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  const path = `${uid}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return { id: crypto.randomUUID(), name: file.name, path, size: file.size, type: file.type || '' };
}

// Open a private file. A blank tab is opened synchronously so it survives
// popup blockers, then pointed at a short-lived signed URL.
export async function openAttachment(path) {
  const tab = window.open('about:blank', '_blank');
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
    if (error) throw error;
    if (tab) tab.location.href = data.signedUrl;
  } catch (e) {
    if (tab) tab.close();
    alertDialog('Could not open the file: ' + (e.message || e));
  }
}

// Returns { el, getValue } — getValue() yields the attachments metadata array.
// opts.guard, when supplied, is called before the file picker opens; if it
// returns false the add is blocked (used by the vault to enforce the free-plan
// item cap). Existing callers pass nothing and are unaffected.
export function createAttachmentsField(initial, opts = {}) {
  const items = (initial || []).slice();
  const guard = typeof opts.guard === 'function' ? opts.guard : null;

  const list = el('div', { class: 'vp-attach-list' });
  const status = el('div', { class: 'vp-attach-status' });
  const fileInput = el('input', { type: 'file', multiple: true, style: { display: 'none' } });
  const addBtn = el('button', { type: 'button', class: 'vp-attach-add' }, '+ Add file');

  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('div', { class: 'vp-attach-empty' }, 'No files attached.'));
      return;
    }
    items.forEach(a => {
      const open = el('button', {
        type: 'button', class: 'vp-attach-name', onclick: () => openAttachment(a.path)
      }, el('i', { class: 'ti ti-file' }), el('span', {}, a.name));
      const rm = el('button', {
        type: 'button', class: 'vp-attach-rm', title: 'Remove', 'aria-label': 'Remove file',
        onclick: () => { const i = items.indexOf(a); if (i > -1) items.splice(i, 1); renderList(); }
      }, '×');
      list.appendChild(el('div', { class: 'vp-attach-row' },
        open, el('span', { class: 'vp-attach-size' }, fmtSize(a.size)), rm));
    });
  }
  renderList();

  addBtn.addEventListener('click', () => { if (guard && !guard()) return; fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        status.textContent = `"${file.name}" is over 10 MB — skipped.`;
        continue;
      }
      status.textContent = `Uploading ${file.name}…`;
      try {
        items.push(await uploadFile(file));
        renderList();
        status.textContent = '';
      } catch (e) {
        status.textContent = `Upload failed: ${e.message || e}`;
      }
    }
  });

  const wrap = el('div', { class: 'vp-attach' }, list, addBtn, status, fileInput);
  return { el: wrap, getValue: () => items, count: () => items.length };
}
