// Event bus view — one real publish() worker thread + three real drain()
// worker threads on the real EventBus. Rates mimic the spec: safety monitor
// drains fast, disk logger slow (watch its queue fill), UI in between.

const NAMES = ['SafetyMonitor', 'DiskLogger', 'UiRenderer'];
const CAP = 16;
const host = document.getElementById('busqueues');
let subs = [];

export function initBus(z) {
  z._zb_reset();
  subs = [z._zb_subscribe(), z._zb_subscribe(), z._zb_subscribe()];
  host.replaceChildren();
  NAMES.forEach((name, i) => {
    const card = document.createElement('div');
    card.className = 'bqueue';
    card.innerHTML = `<h4>${name} <span>queue ${subs[i]} · cap ${CAP}</span></h4>
      <div class="bar"><i id="bq-bar${i}"></i></div>
      <div class="meta">
        <span>occupancy <b id="bq-occ${i}">0</b></span>
        <span>drained <b id="bq-dr${i}">0</b></span>
        <span>last seq <b id="bq-seq${i}">—</b></span>
      </div>`;
    host.append(card);
  });
  const $ = (id) => document.getElementById(id);
  $('bus-rt').onclick = () => {
    const btn = $('bus-rt');
    if (z._rt_running()) {
      z._rt_stop();
      btn.textContent = 'start pipeline';
      btn.classList.remove('on');
    } else {
      z._zb_rt_start(+$('bus-hz').value, +$('bus-hz0').value,
                     +$('bus-hz1').value, +$('bus-hz2').value);
      btn.textContent = 'stop pipeline';
      btn.classList.add('on');
    }
  };
  $('bus-reset').onclick = () => {
    z._rt_stop();
    $('bus-rt').textContent = 'start pipeline';
    $('bus-rt').classList.remove('on');
    initBus(z); // fresh bus + fresh subscribers
  };
}

export function updateBus(z) {
  const $ = (id) => document.getElementById(id);
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const occ = z._zb_occupancy(subs[i]);
    const dr = z._rt_drained(subs[i]);
    total += dr;
    $(`bq-occ${i}`).textContent = occ;
    $(`bq-dr${i}`).textContent = dr;
    $(`bq-seq${i}`).textContent = dr > 0 ? z._zb_last_field(subs[i], 0) : '—';
    const bar = $(`bq-bar${i}`);
    bar.style.width = `${(occ / CAP) * 100}%`;
    bar.classList.toggle('hot', occ >= CAP - 1);
  }
  $('b-pub').textContent = z._rt_published();
  $('b-fail').textContent = z._rt_pub_fail();
  $('b-drained').textContent = total;
}
