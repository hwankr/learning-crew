// Run on a fresh ?pixel-demo=1 page with motion enabled.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async (fn, timeout = 7000) => {
    const end = Date.now() + timeout;
    while (!fn()) {
      if (Date.now() > end) throw Error('Timed out waiting for the scene');
      await sleep(30);
    }
  };
  const button = (label) => [...document.querySelectorAll('button')].find((b) =>
    b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  const actor = (id) => document.querySelector(`.px-actor[data-member="${id}"]`);
  const room = document.querySelector('.pixel-room');
  const world = document.querySelector('.pixel-room-world');
  const selected = () => document.querySelector('.pixel-room-insight').dataset.selectedMember;
  const results = [];

  button('진주 캐릭터 보기').click();
  await wait(() => selected() === 'jj');
  assert(actor('jj').getAttribute('aria-pressed') === 'true', 'Sidebar did not select the world character');
  actor('th').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(() => selected() === 'th');
  assert(button('태현 캐릭터 보기').getAttribute('aria-pressed') === 'true', 'World did not select the sidebar character');
  actor('sh').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await wait(() => selected() === 'sh');
  assert(document.querySelector('.pixel-room-live').textContent === '2명 공부 중', 'Selecting a character changed study status');
  results.push('PASS: two-way character selection and Enter/Space preserve study status');

  button('승환 도서관에서 공부 시작').click();
  await wait(() => actor('sh').dataset.moving === 'true');
  const travel = actor('sh').getAnimations()[0];
  assert(travel, 'Missing native travel animation');
  const palettes = [];
  for (const [label, mood, visibleClass] of [
    ['밤', 'night', '.px-night-only'], ['비', 'rain', '.px-rain-only'], ['노을', 'sunset', '.px-sunset-only'],
  ]) {
    button(`${label} 분위기`).click();
    await wait(() => room.dataset.mood === mood);
    palettes.push(getComputedStyle(room).getPropertyValue('--px-sky'));
    assert(getComputedStyle(world.querySelector(visibleClass)).display !== 'none', `${mood} ornaments are hidden`);
    assert(actor('sh').getAnimations()[0] === travel, 'Changing mood restarted or interrupted the walk');
  }
  button('웅 캐릭터 보기').click();
  await wait(() => selected() === 'wg');
  assert(actor('sh').getAnimations()[0] === travel, 'Selecting a character interrupted another walk');
  assert(new Set(palettes).size === 3, 'Moods use the same palette');
  const directions = new Set();
  while (actor('sh').dataset.moving === 'true') {
    directions.add(actor('sh').querySelector('.px-person').dataset.facing);
    await sleep(30);
  }
  assert(['north', 'east', 'west'].every((direction) => directions.has(direction)), 'Walking did not follow the route direction');
  assert(actor('sh').querySelector('.px-person').dataset.facing === 'south', 'Arrival did not settle the pose');
  results.push('PASS: distinct moods, directional walking, and uninterrupted travel during selection/theme changes');

  button('캐릭터 움직임 끄기').click();
  await sleep(80);
  for (const label of ['밤', '비', '노을']) {
    button(`${label} 분위기`).click();
    await sleep(80);
    assert(world.getAnimations({ subtree: true }).length === 0, `${label} ignores the motion preference`);
  }
  button('캐릭터 움직임 켜기').click();
  await sleep(80);
  results.push('PASS: every mood respects the motion toggle');

  button('자동 시연').click();
  await wait(() => button('시연 멈추기'));
  await wait(() => button('자동 시연'), 21_000);
  await wait(() => [...world.querySelectorAll('.px-actor')].every((a) => a.dataset.moving === 'false'));
  assert(actor('sh').dataset.activity === 'rest', 'Autoplay did not finish the first study session');
  assert(['wg', 'th', 'jj', 'kj'].every((id) => actor(id).dataset.activity === 'library'), 'Autoplay did not seat the other four members');
  assert(document.querySelector('.pixel-room-live').textContent === '4명 공부 중', 'Autoplay counter mismatch');
  assert(document.querySelectorAll('.pixel-demo-journal li').length === 3, 'Activity journal did not retain the latest three events');
  assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Demo contacted the API');
  results.push('PASS: complete autoplay, correct final state, and bounded activity journal without API requests');
  return results;
})()
