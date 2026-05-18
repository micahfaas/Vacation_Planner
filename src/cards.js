// Card lifecycle operations: create, remove, duplicate, move.
import { activeTrip } from './state.js';
import { save } from './storage.js';
import { render } from './render.js';

function newId() {
  const t = activeTrip();
  return 'c' + (t.nextId++);
}

export function addCard(card, target) {
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

export function removeCard(id) {
  const t = activeTrip();
  delete t.cards[id];
  t.library = t.library.filter(x => x !== id);
  Object.keys(t.schedule).forEach(d => {
    t.schedule[d] = t.schedule[d].filter(x => x !== id);
    if (t.schedule[d].length === 0) delete t.schedule[d];
  });
  save(); render();
}

export function duplicateCard(id) {
  const t = activeTrip();
  const src = t.cards[id]; if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  delete copy.id;
  copy.title = src.title + ' (copy)';
  addCard(copy, { kind: 'lib' });
}

export function moveCard(id, target) {
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
