// Tiny hyperscript-style element builder.
export function el(tag, props, ...children) {
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

// A click-to-toggle section: a header with a chevron over a body that hides
// when collapsed. Append your fields to the returned `body`. `open` sets the
// initial state (callers open sections that already have data).
export function collapsible(title, open) {
  const body = el('div', { class: 'vp-collapse-body' });
  const head = el('button', { type: 'button', class: 'vp-collapse-head' },
    el('i', { class: 'ti ti-chevron-right vp-collapse-chevron', 'aria-hidden': 'true' }),
    el('span', {}, title));
  const wrap = el('div', { class: 'vp-collapse' }, head, body);
  function setOpen(v) { wrap.classList.toggle('vp-collapse-open', !!v); }
  head.addEventListener('click', () => setOpen(!wrap.classList.contains('vp-collapse-open')));
  setOpen(open);
  return { el: wrap, body, setOpen };
}
