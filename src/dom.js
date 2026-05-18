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
