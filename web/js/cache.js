// Cache-line view — conceptual MESI visualisation. The layout toggle mirrors
// the real struct layout (head_/tail_ adjacent vs alignas(64)-separated);
// the bounce animation fires when the REAL threads (ring view) are moving
// the indices — the traffic is real, the coherence drawing is the teaching aid.

const host = document.getElementById('cachelines');
const status = document.getElementById('cache-status');
let padded = true;
let prev = { head: -1, tail: -1 };

function block(cls, label, pct) {
  const d = document.createElement('div');
  d.className = `cl-block ${cls}`;
  d.style.width = `${pct}%`;
  d.textContent = label;
  return d;
}

function line(tag, blocks) {
  const l = document.createElement('div');
  l.className = 'cache-line';
  const t = document.createElement('span');
  t.className = 'tag';
  t.textContent = tag;
  l.append(t, ...blocks);
  return l;
}

function render() {
  host.replaceChildren();
  if (padded) {
    host.append(
      line('line 0 · core 0 owns', [
        block('head', 'head_ 8B', 12.5), block('pad', 'pad 56B', 87.5)]),
      line('line 1 · core 1 owns', [
        block('tail', 'tail_ 8B', 12.5), block('pad', 'pad 56B', 87.5)]));
  } else {
    host.append(
      line('line 0 · BOTH cores fight for it', [
        block('head', 'head_ 8B', 12.5), block('tail', 'tail_ 8B', 12.5),
        block('', 'storage… 48B', 75)]),
      line('line 1 · storage', [block('', 'payload slots', 100)]));
  }
}

export function initCache() {
  render();
  document.getElementById('cache-toggle').onclick = (e) => {
    padded = !padded;
    e.target.textContent = `layout: ${padded ? 'padded' : 'unpadded'}`;
    render();
  };
}

export function updateCache(z) {
  const head = z._zq_head(), tail = z._zq_tail();
  const headMoved = head !== prev.head, tailMoved = tail !== prev.tail;
  const storming = !padded && z._rt_running() && (headMoved || tailMoved);

  host.querySelectorAll('.cl-block.head,.cl-block.tail').forEach((b) => {
    const moved = b.classList.contains('head') ? headMoved : tailMoved;
    b.classList.toggle('storm', storming && moved);
  });

  status.textContent = padded
    ? 'each index on its own line — zero coherence traffic between cores'
    : (storming ? 'MESI invalidation bouncing line 0 between cores'
                : 'shared line — every index write invalidates the peer');
  prev = { head, tail };
}
