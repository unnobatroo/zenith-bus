// Ring buffer view — renders REAL state from the live SPSCQueue object.
// Manual buttons call real try_push/try_pop; "start real threads" spawns
// actual wasm worker threads that race on the shared queue.

const svg = document.getElementById('ring');
const NS = 'http://www.w3.org/2000/svg';
const log = document.getElementById('memlog');
let cap = 8;
let slotRefs = []; // {g, rect, text} per slot index
let markerT, markerH; // tail/head marker groups

function probe(z) {
  return {
    head: z._zq_head(), tail: z._zq_tail(),
    chead: z._zq_cached_head(), ctail: z._zq_cached_tail(),
    size: z._zq_size(),
  };
}

function narrate(before, after, ok, op) {
  const li = document.createElement('li');
  if (!ok) {
    li.innerHTML = `<em class="err">try_${op} → false</em> (${op === 'push' ? 'queue full' : 'queue empty'})`;
  } else if (op === 'push') {
    const reload = after.chead !== before.chead
      ? ` · <em class="cac">cached_head_ reload → ${after.chead}</em>` : '';
    li.innerHTML = `storage_[${before.tail & (cap - 1)}] ← v` +
      ` · <em class="rel">tail_.store(${after.tail}, release)</em>${reload}`;
  } else {
    const reload = after.ctail !== before.ctail
      ? ` · <em class="cac">cached_tail_ reload → ${after.ctail}</em>` : '';
    li.innerHTML = `<em class="acq">head_ read → slot[${before.head & (cap - 1)}]</em>` +
      ` · <em class="rel">head_.store(${after.head}, release)</em>${reload}`;
  }
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Angle for slot i, 12 o'clock = slot 0, clockwise.
function slotAngle(i, n) { return (i / n) * Math.PI * 2 - Math.PI / 2; }

function buildRing(z) {
  svg.replaceChildren();
  slotRefs = [];
  cap = z._zq_capacity();
  const cx = 190, cy = 190, r = 128;
  // slot size shrinks with capacity so 32 slots never overlap
  const w = Math.min(40, Math.floor((2 * Math.PI * r) / cap) - 6);
  const h = Math.round(w * 0.62);

  for (let i = 0; i < cap; i++) {
    const a = slotAngle(i, cap);
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const g = el('g', { class: 'slot' });
    g.dataset.slot = i;
    const rect = el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 3 });
    const t = el('text', { x, y });
    g.append(rect, t);
    svg.append(g);
    slotRefs.push({ g, text: t });
  }

  // center readout
  const val = el('text', { class: 'ring-center-val', x: cx, y: cy - 8, id: 'ring-center' });
  const sub = el('text', { class: 'ring-center-cap', x: cx, y: cy + 14 });
  sub.textContent = 'occupied';
  svg.append(val, sub);

  // head/tail markers ride outside the ring on their own layer
  markerT = el('g', { class: 'marker' });
  const tc = el('circle', { r: 9, fill: '#2456D6' });
  const tt = el('text', { y: 0.5 });
  tt.textContent = 'T';
  markerT.append(tc, tt);
  markerH = el('g', { class: 'marker' });
  const hc = el('circle', { r: 9, fill: '#0D8A6E' });
  const ht = el('text', { y: 0.5 });
  ht.textContent = 'H';
  markerH.append(hc, ht);
  svg.append(markerT, markerH);
}

function placeMarker(marker, i) {
  const a = slotAngle(i % cap, cap);
  const cx = 190, cy = 190, r = 128 + 24;
  marker.setAttribute('transform',
    `translate(${cx + r * Math.cos(a)},${cy + r * Math.sin(a)})`);
}

export function initRing(z) {
  buildRing(z);
  const $ = (id) => document.getElementById(id);

  // Manual ops are disabled while real threads run — a JS-side push would
  // be a second producer, breaking the single-producer contract.
  $('ring-push').onclick = () => {
    if (z._rt_running()) return;
    const b = probe(z);
    const ok = z._zq_push(Math.floor(Math.random() * 900) + 100) === 1;
    narrate(b, probe(z), ok, 'push');
  };
  $('ring-pop').onclick = () => {
    if (z._rt_running()) return;
    const b = probe(z);
    const ok = z._zq_pop() !== -1;
    narrate(b, probe(z), ok, 'pop');
  };
  $('ring-reset').onclick = () => { z._zq_reset(); log.replaceChildren(); };
  $('ring-cap').onchange = (e) => {
    z._zq_set_capacity(+e.target.value);
    buildRing(z);
  };
  $('ring-rt').onclick = () => {
    const btn = $('ring-rt');
    if (z._rt_running()) {
      z._rt_stop();
      btn.textContent = 'start real threads';
      btn.classList.remove('on');
      document.getElementById('wstatus').classList.remove('live');
    } else {
      z._zq_rt_start(+$('ring-push-hz').value, +$('ring-pop-hz').value);
      btn.textContent = 'stop threads — indices move on their own';
      btn.classList.add('on');
      document.getElementById('wstatus').classList.add('live');
    }
  };
}

export function updateRing(z) {
  const s = probe(z);
  const $ = (id) => document.getElementById(id);
  $('p-tail').textContent = s.tail;
  $('p-head').textContent = s.head;
  $('p-chead').textContent = s.chead;
  $('p-ctail').textContent = s.ctail;
  $('p-pushed').textContent = z._rt_pushed();
  $('p-popped').textContent = z._rt_popped();
  $('p-pfail').textContent = z._rt_push_fail();
  $('p-efail').textContent = z._rt_pop_fail();
  document.getElementById('ring-center').textContent = s.size;

  // occupied slots: indices [head, tail) mod capacity — the real ring semantics
  const occ = new Set();
  for (let i = s.head; i < s.tail && occ.size < cap; i++) occ.add(i % cap);

  for (const { g, text } of slotRefs) {
    const i = +g.dataset.slot;
    g.classList.toggle('full', occ.has(i));
    g.classList.toggle('head', i === s.head % cap && s.size > 0);
    g.classList.toggle('tail', i === s.tail % cap && s.size < cap);
    text.textContent = occ.has(i) ? z._zq_slot_value(i) : '';
  }
  placeMarker(markerT, s.tail);
  placeMarker(markerH, s.head);
}
