// Ring buffer view — renders REAL state from the live SPSCQueue object.
// Manual buttons call real try_push/try_pop; "start real threads" spawns
// actual wasm worker threads that race on the shared queue.

const svg = document.getElementById('ring');
const NS = 'http://www.w3.org/2000/svg';
const log = document.getElementById('memlog');
let cap = 8;
let prev = null; // previous probe snapshot, for op narration

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

function buildRing(z) {
  svg.replaceChildren();
  const N = z._zq_capacity(), cx = 170, cy = 170, r = 118;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'slot');
    g.dataset.slot = i;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', x - 19); rect.setAttribute('y', y - 13);
    rect.setAttribute('width', 38); rect.setAttribute('height', 26);
    rect.setAttribute('rx', 2);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y + 3);
    g.append(rect, t);
    svg.append(g);
  }
  const c = document.createElementNS(NS, 'text');
  c.setAttribute('class', 'ring-label');
  c.setAttribute('x', cx); c.setAttribute('y', cy + 4);
  c.id = 'ring-center';
  svg.append(c);
}

export function initRing(z) {
  cap = z._zq_capacity();
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
    cap = z._zq_capacity();
    buildRing(z);
  };
  $('ring-rt').onclick = () => {
    const btn = $('ring-rt');
    if (z._rt_running()) {
      z._rt_stop();
      btn.textContent = 'start real threads';
      btn.classList.remove('on');
    } else {
      z._zq_rt_start(+$('ring-push-hz').value, +$('ring-pop-hz').value);
      btn.textContent = 'stop threads';
      btn.classList.add('on');
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
  document.getElementById('ring-center').textContent = `${s.size}/${cap}`;

  // occupied slots: indices [head, tail) mod capacity — the real ring semantics
  const occ = new Set();
  for (let i = s.head; i < s.tail && occ.size < cap; i++) occ.add(i % cap);
  svg.querySelectorAll('.slot').forEach((g) => {
    const i = +g.dataset.slot;
    g.classList.toggle('full', occ.has(i));
    g.classList.toggle('head', i === s.head % cap && s.size > 0);
    g.classList.toggle('tail', i === s.tail % cap && s.size < cap);
    const t = g.querySelector('text');
    t.textContent = occ.has(i) ? z._zq_slot_value(i) : '';
  });
  prev = s;
}
