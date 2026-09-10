// Run in the token-free app demo (/?user=승환), with the crew panel visible.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(new URLSearchParams(location.search).get('user') === '승환' && !localStorage.getItem('lc-token'), 'Use the token-free 승환 app demo');
  assert(document.querySelector('.demo-note') || document.querySelector('.mhome-head'), 'App demo is not visible');
  const room = document.querySelector('.pixel-room');
  const campus = room.closest('.crew-campus');
  const world = room.querySelector('.pixel-room-world');
  const actor = (id) => world.querySelector(`.px-actor[data-member="${id}"]`);
  const button = (label) => document.querySelector(`button[aria-label="${label}"]`);
  const selected = () => room.querySelector('.pixel-room-insight').dataset.selectedMember;
  const report = [];
  assert(campus?.querySelector('.crew') && room.querySelector('.pixel-room-checkin .chk-off'), 'Check-in, map and roster are not composed together');
  const members = ['sh', 'wg', 'th', 'jj', 'kj'];
  for (const id of members) {
    const expected = actor(id).querySelector('image').getAttribute('href');
    const avatars = [...document.querySelectorAll(`[data-crew-avatar="${id}"] image`)];
    assert(avatars.length >= 2 && avatars.every((image) => image.getAttribute('href') === expected), `${id}: avatars do not match the world character`);
  }
  const clipIds = [...document.querySelectorAll('[data-crew-avatar] clipPath')].map((clip) => clip.id);
  assert(clipIds.length === new Set(clipIds).size, 'Shared avatars have duplicate SVG clip IDs');
  report.push('PASS: check-in, map and roster share one surface; app avatars reuse the same five character assets with unique clip IDs');
  const settings = room.querySelector('.pixel-room-settings');
  assert(!settings.open, 'Advanced controls should initially be folded');
  settings.querySelector('summary').click();
  button('자율 행동').click();
  await sleep(80);
  const ownCheckin = [...room.querySelectorAll('.chk-tile')].find((tile) => tile.textContent.trim() === '도서관');
  ownCheckin.click();
  await sleep(100);
  const walk = actor('sh').getAnimations()[0];
  assert(walk?.playState === 'running', 'The integrated check-in did not start a walk');
  const afterCheckin = members.map((id) => actor(id).dataset.activity).join();
  button('웅 크루 상태 보기').click();
  await sleep(100);
  assert(selected() === 'wg' && button('웅 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Roster and map selections diverged');
  assert(actor('sh').getAnimations()[0] === walk, 'Selecting a crew member restarted another member’s walk');
  actor('sh').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(50);
  assert(selected() === 'sh' && button('승환 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Keyboard map selection did not reach the roster');
  button('현재 노을 · 밤 분위기로 바꾸기').click();
  await sleep(50);
  assert(actor('sh').getAnimations()[0] === walk, 'Changing the mood restarted a walk');
  settings.querySelector('summary').click();
  assert(!settings.open && room.querySelector('.pixel-room-world') === world, 'Folding settings remounted the world');
  button('진주 크루 상태 보기').click();
  await sleep(50);
  assert(room.querySelector('.pixel-room-insight').textContent.includes('카페에서 공부 중'), 'Other study locations lost their real status');
  assert(members.map((id) => actor(id).dataset.activity).join() === afterCheckin, 'Selection changed a check-in');
  const deadline = Date.now() + 10_000;
  while (actor('sh').dataset.phase !== 'acting') {
    assert(Date.now() < deadline, 'Study walk never arrived');
    await sleep(70);
  }
  assert(actor('sh').dataset.activity === 'library' && actor('sh').dataset.spot === 'home', 'Study did not arrive at the real study seat');
  report.push('PASS: integrated study check-in arrives; roster, map keyboard selection and mood changes preserve the active walk and every check-in');
  settings.querySelector('summary').click();
  button('캐릭터 움직임 끄기').click();
  await sleep(100);
  assert(room.querySelector('.pixel-room-stage').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), 'Settings pause left a character moving');
  room.querySelector('.chk-end').click();
  await sleep(100);
  assert(actor('sh').dataset.activity === 'rest' && room.querySelectorAll('.chk-tile').length === 4, 'Ending study did not restore place choices');
  assert(button('진주 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Own check-in overwrote the selected crew member');
  button('캐릭터 움직임 켜기').click();
  settings.querySelector('summary').click();
  assert(!document.querySelector('vite-error-overlay'), 'Vite error overlay present');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Page overflows horizontally');
  assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Local demo called the API');
  report.push('PASS: settings disclose/pause/resume correctly; ending study restores places; other selection and location remain intact; no API calls or page overflow');
  return report;
})()
