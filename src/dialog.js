// Promise-based modal dialogs that replace the browser's native
// confirm() / prompt() / alert(), styled like the rest of the app.
import { el } from './dom.js';

// Resolves when the backdrop leaves the DOM, so every close path — a
// button, a backdrop click, or the global Escape handler — settles the
// promise through one mechanism.
function show(build) {
  return new Promise(resolve => {
    const bg = el('div', { class: 'vp-modal-bg' });
    const m = el('div', { class: 'vp-modal vp-dialog' });
    bg.appendChild(m);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });

    const state = { value: undefined };
    build(m, bg, state);

    const obs = new MutationObserver(() => {
      if (!document.body.contains(bg)) { obs.disconnect(); resolve(state.value); }
    });
    obs.observe(document.body, { childList: true });
    document.body.appendChild(bg);
  });
}

function actionRow(buttons) {
  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  buttons.forEach(b => right.appendChild(b));
  actions.appendChild(right);
  return actions;
}

// Resolves true (confirmed) or false (cancelled / Escape / backdrop).
export function confirmDialog(message, opts = {}) {
  return show((m, bg, state) => {
    state.value = false;
    if (opts.title) m.appendChild(el('h3', {}, opts.title));
    m.appendChild(el('p', { class: 'vp-dialog-msg' }, message));
    const cancel = el('button', { onclick: () => bg.remove() }, opts.cancelText || 'Cancel');
    const ok = el('button', {
      class: opts.danger ? 'vp-delete' : 'vp-save',
      onclick: () => { state.value = true; bg.remove(); }
    }, opts.confirmText || 'OK');
    m.appendChild(actionRow([cancel, ok]));
    setTimeout(() => ok.focus(), 30);
  });
}

// Resolves undefined; await it only if you need to block until dismissed.
export function alertDialog(message, opts = {}) {
  return show((m, bg) => {
    if (opts.title) m.appendChild(el('h3', {}, opts.title));
    m.appendChild(el('p', { class: 'vp-dialog-msg' }, message));
    const ok = el('button', { class: 'vp-save', onclick: () => bg.remove() }, opts.confirmText || 'OK');
    m.appendChild(actionRow([ok]));
    setTimeout(() => ok.focus(), 30);
  });
}

// Resolves the entered string, or null if cancelled.
export function promptDialog(message, defaultValue = '', opts = {}) {
  return show((m, bg, state) => {
    state.value = null;
    if (opts.title) m.appendChild(el('h3', {}, opts.title));
    m.appendChild(el('label', {}, message));
    const input = el('input', { type: 'text', value: defaultValue });
    m.appendChild(input);
    function submit() { state.value = input.value; bg.remove(); }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    const cancel = el('button', { onclick: () => bg.remove() }, 'Cancel');
    const ok = el('button', { class: 'vp-save', onclick: submit }, opts.confirmText || 'Save');
    m.appendChild(actionRow([cancel, ok]));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
