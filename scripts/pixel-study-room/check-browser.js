// Run on ?pixel-demo=1 with agent-browser eval --stdin < this file.
// Exercises real React handlers and browser animations, including interrupted travel.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const actor = (id) => document.querySelector(`.px-actor[data-member="${id}"]`);
  const point = (id) => {
    const matrix = new DOMMatrix(getComputedStyle(actor(id)).transform);
    return { x: matrix.e, y: matrix.f };
  };
  const click = (label) => {
    const element = [...document.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label') === label || button.textContent.trim().startsWith(label));
    if (!element || element.disabled) throw Error(`Unavailable button: ${label}`);
    element.click();
  };
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async (fn) => {
    const end = Date.now() + 7000;
    while (!fn()) {
      if (Date.now() > end) throw Error('Timed out waiting for the scene');
      await sleep(30);
    }
  };
  const settled = () => [...document.querySelectorAll('.px-actor')].every((a) => a.dataset.moving === 'false');
  const results = [];
  assert(document.querySelector('.pixel-room-stage').dataset.motion === 'on', 'Enable motion before running the travel checks');
  assert(actor('sh').dataset.activity === 'rest', 'Reload the demo before running these checks');

  click('승환 도서관에서 공부 시작');
  await wait(() => actor('sh').dataset.moving === 'true');
  await wait(settled);
  assert(point('sh').x === 225 && point('sh').y === 145, 'Starting study did not reach the desk');
  click('승환 공부 종료');
  await wait(() => actor('sh').dataset.moving === 'true');
  await sleep(160);
  const before = point('sh');
  click('승환 도서관에서 공부 시작');
  await sleep(40);
  const after = point('sh');
  assert(Math.hypot(before.x - after.x, before.y - after.y) < 20, 'Interrupted walk teleported');
  await wait(settled);
  assert(point('sh').x === 225 && point('sh').y === 145, 'Restart did not reach the latest target');
  results.push('PASS: start, end, and mid-walk reversal');

  click('모두 쉬어가기');
  await sleep(80);
  click('캐릭터 움직임 끄기');
  await wait(settled);
  const rest = { sh: [198, 350], wg: [242, 350], th: [324, 364], jj: [448, 351], kj: [492, 351] };
  assert([...document.querySelectorAll('.px-actor')].every((a) => {
    const matrix = new DOMMatrix(getComputedStyle(a).transform);
    return matrix.e === rest[a.dataset.member][0] && matrix.f === rest[a.dataset.member][1];
  }), 'Disabling motion did not settle the latest state');
  assert(document.querySelector('.pixel-room-world').getAnimations({ subtree: true }).length === 0, 'Decorative animation still running');
  click('모두 도서관으로');
  await sleep(80);
  assert(settled() && point('sh').y === 145, 'State changes with motion disabled missed their destination');
  click('캐릭터 움직임 켜기');
  await sleep(80);
  assert(settled(), 'Enabling motion replayed arrival');
  results.push('PASS: motion toggle, status changes while paused, and resume without replay');

  click('모두 쉬어가기');
  await sleep(80);
  await wait(settled);
  click('모두 도서관으로');
  await sleep(80);
  await wait(settled);
  const all = [...document.querySelectorAll('.px-actor')].map((a) => new DOMMatrix(getComputedStyle(a).transform));
  assert(all.filter((m) => m.f === 145).length === 3 && all.filter((m) => m.f === 224).length === 2 && new Set(all.map((m) => m.e)).size === 5, 'Simultaneous arrivals overlapped');
  assert(document.querySelector('.pixel-room-live').textContent === '5명 공부 중', 'Library counter mismatch');
  results.push('PASS: five simultaneous arrivals/departures and stable seating');

  // A hidden tab settles its state and disables ornamental animation; returning does not replay it.
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await sleep(80);
  assert(document.querySelector('.pixel-room-world').getAnimations({ subtree: true }).length === 0, 'Hidden scene kept animating');
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
  await sleep(80);
  assert(settled(), 'Returning to the tab replayed a walk');
  results.push('PASS: hidden/visible page lifecycle');

  click('자동 시연');
  await sleep(80); // Let the demo reset render before observing the first scheduled arrival.
  await wait(() => actor('sh').dataset.activity === 'library');
  click('승환 공부 종료');
  await sleep(2600);
  assert(actor('wg').dataset.activity === 'rest', 'Cancelled autoplay changed another member');
  assert([...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '자동 시연'), 'Manual action did not stop autoplay');
  results.push('PASS: manual actions cancel pending autoplay steps');

  assert(!document.querySelector('vite-error-overlay'), 'Vite error overlay');
  assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Standalone demo contacted the API');
  results.push('PASS: preview has no API requests');
  return results;
})()
