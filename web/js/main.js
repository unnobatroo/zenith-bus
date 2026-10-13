// Entry point: loads the real compiled ZenithBus module and wires the views.
// The Emscripten factory (web/wasm/zenith.js) exports the C API as z._<name>.
import initZenith from '../wasm/zenith.js';
import { initRing, updateRing } from './ring.js';
import { initCache, updateCache } from './cache.js';
import { initBus, updateBus } from './bus.js';

const status = document.getElementById('wstatus');

let z;
try {
  z = await initZenith();
  status.textContent = `wasm live · ${z._zq_capacity()}-slot queue · ` +
    (crossOriginIsolated ? 'threads enabled' : 'threads blocked (needs COOP/COEP)');
} catch (e) {
  status.textContent = 'wasm failed to load — serve with COOP/COEP headers (see web/serve.py)';
  throw e;
}

const views = { ring: updateRing, cache: updateCache, bus: updateBus };
initRing(z);
initCache(z);
initBus(z);

// Tab switching — threads keep running across views on purpose.
document.querySelectorAll('#tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('active', v.id === `view-${b.dataset.view}`));
  }));

// Single rAF loop: poll real wasm state → repaint active view.
function frame() {
  const active = document.querySelector('#tabs button.active').dataset.view;
  views[active](z);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
