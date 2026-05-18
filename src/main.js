// App entry: wire up the header controls and boot.
import './styles.css';
import { load } from './storage.js';
import { render } from './render.js';
import { exportJSON, importJSON } from './io.js';
import { openTripsMenu } from './trips.js';

document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
document.getElementById('vp-export-btn').addEventListener('click', exportJSON);
document.getElementById('vp-import-btn').addEventListener('click', () => document.getElementById('vp-import-file').click());
document.getElementById('vp-import-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importJSON(f);
  e.target.value = '';
});

load();
render();
