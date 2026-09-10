// Run in a fresh pixel preview or token-free 승환 app demo with the crew panel visible.
// Native mouse/touch panning and Tab boundaries are also covered in fullscreen-verification.json.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  const query = new URLSearchParams(location.search);
  assert(query.has('pixel-demo') || (query.get('user') === '승환' && !localStorage.getItem('lc-token')), 'Use an isolated local demo');
  const button = (label) => document.querySelector(`button[aria-label="${label}"]`);
  const map = document.querySelector('.pixel-map');
  const viewport = map.querySelector('.pixel-map-viewport');
  const world = map.querySelector('.pixel-room-world');
  const room = map.closest('.pixel-room');
  const actors = [...world.querySelectorAll('.px-actor')];
  const actor = (id) => world.querySelector(`.px-actor[data-member="${id}"]`);
  assert(actor('sh').dataset.activity === 'rest', 'Start with 승환 resting');
  const start = button('승환 도서관에서 공부 시작')
    ?? [...document.querySelectorAll('.chk-tile')].find((tile) => tile.querySelector('.chk-tile-label')?.textContent === '도서관');
  start.click();
  await sleep(80);
  const walk = actor('sh').getAnimations()[0];
  assert(walk?.playState === 'running', 'Check-in did not start a walk');
  const activities = actors.map((member) => member.dataset.activity).join();
  const scenery = world.querySelector('.px-canopy').getAnimations()[0];
  const inline = { height: viewport.clientHeight, zoom: viewport.dataset.zoom };
  const overflow = document.documentElement.style.overflow;
  const gutter = document.documentElement.style.scrollbarGutter;
  const opener = button('지도 전체화면으로 보기');
  opener.focus(); opener.click();
  await sleep(120);
  const full = map.getBoundingClientRect();
  assert(full.x === 0 && full.y === 0 && full.width === innerWidth && full.height === innerHeight, 'Fullscreen did not fill the browser');
  assert(viewport.clientHeight > inline.height, 'Map did not gain space');
  assert(document.querySelector('.pixel-room-world') === world && actors.every((member) => member === actor(member.dataset.member)), 'Fullscreen remounted the world or actors');
  assert(actor('sh').getAnimations()[0] === walk && world.querySelector('.px-canopy').getAnimations()[0] === scenery, 'Fullscreen restarted travel or scenery');
  assert(document.activeElement === button('전체화면 닫기'), 'Close button did not receive focus');
  assert(start.closest('[inert]'), 'Background check-in is still interactive');
  const clock = Number(room.dataset.lifeClock);
  await sleep(600);
  assert(Number(room.dataset.lifeClock) > clock, 'Fullscreen paused autonomous life');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(40);
  assert(map.querySelector('.pixel-map-toolbar').hidden && button('전체화면 닫기').checkVisibility(), 'Hiding controls hid the exit');
  actor('wg').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(40);
  assert(room.querySelector('.pixel-room-insight').dataset.selectedMember === 'wg', 'Fullscreen character selection failed');
  map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(120);
  assert(map.dataset.fullscreen === 'false' && document.activeElement === opener, 'Escape did not close and restore focus');
  opener.click(); await sleep(100);
  button('지도 확대').click(); await sleep(50);
  button('전체화면 닫기').click(); await sleep(120);
  assert(viewport.dataset.zoom === inline.zoom, 'Fullscreen changed the inline zoom');
  assert(actors.map((member) => member.dataset.activity).join() === activities, 'Fullscreen changed check-ins');
  assert(document.documentElement.style.overflow === overflow && document.documentElement.style.scrollbarGutter === gutter && !start.closest('[inert]'), 'Closing left the background locked');
  assert(document.documentElement.scrollWidth <= innerWidth && !document.querySelector('vite-error-overlay'), 'Page overflow or runtime overlay');
  assert(!performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname.startsWith('/api/')), 'Demo called the API');
  return { result: 'PASS', checks: ['fills browser viewport', 'preserves world, actors and native animations', 'life clock advances', 'background locked while open', 'exit remains visible', 'character selection preserves check-ins', 'Escape and close restore focus and inline zoom', 'background restored', 'no overflow or API calls'] };
})()
