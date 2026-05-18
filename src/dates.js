// Date helpers. All calendar dates are local-time and ISO YYYY-MM-DD strings.
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function fmtShort(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtMin(min) {
  if (!min || min < 0) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? (h + 'h' + (m ? ' ' + m + 'm' : '')) : (m + 'm');
}

export function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
