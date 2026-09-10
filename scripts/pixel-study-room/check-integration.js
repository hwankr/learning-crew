// Run in the token-free app demo (/?user=승환), with the crew panel visible.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(new URLSearchParams(location.search).get('user') === '승환' && !localStorage.getItem('lc-token'), 'Use the token-free 승환 app demo');
  assert(document.querySelector('.demo-note') || document.querySelector('.mhome-head'), 'App demo is not visible');
  const room = document.querySelector('.pixel-room');
  const world = room.querySelector('.pixel-room-world');
  const actor = (id) => world.querySelector(`.px-actor[data-member="${id}"]`);
  const button = (label) => document.querySelector(`button[aria-label="${label}"]`);
  const selected = () => room.querySelector('.pixel-room-insight').dataset.selectedMember;
  const report = [];
  const members = ['sh', 'wg', 'th', 'jj', 'kj'];
  const checkin = document.querySelector('.chk-off');
  assert(checkin && !room.contains(checkin) && !document.querySelector('.crew-campus'), 'The original check-in or open layout was replaced');
  const sections = [checkin, room, document.querySelector('.evlead'), document.querySelector('.crew'), document.querySelector('.mon')];
  assert(sections.every((section, i) => section && (!i || sections[i - 1].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Original home section order changed');
  for (const selector of ['html', 'body', '.screen', '.topbar']) {
    const surface = document.querySelector(selector);
    if (surface) assert(getComputedStyle(surface).backgroundColor === 'rgb(255, 255, 255)', `${selector}: original white background changed`);
  }
  const roomStyle = getComputedStyle(room);
  assert(roomStyle.borderTopWidth === '0px' && roomStyle.boxShadow === 'none', 'An outer card still encloses the study space');
  assert(!document.querySelector('.crew-av image'), 'Existing app avatars were replaced');
  report.push('PASS: original white theme, avatars, separate check-in and section order; study space has no outer card');
  assert(!room.querySelector('.pixel-room-settings, .pixel-room-tools, .pixel-room-moods'), 'App space settings are still visible');
  assert(room.dataset.autonomous === 'true' && room.dataset.mood === 'sunset', 'App defaults are not autonomous sunset');
  const initialClock = Number(room.dataset.lifeClock);
  await sleep(1100);
  assert(Number(room.dataset.lifeClock) > initialClock, 'Autonomous life did not start by default');
  assert(room.querySelector('.pixel-room-stage').getAnimations({ subtree: true }).some((a) => a.playState === 'running'), 'Character motion did not start by default');
  report.push('PASS: space settings are absent; autonomous life and character motion start automatically at sunset');
  const ownCheckin = [...document.querySelectorAll('.chk-tile')].find((tile) => tile.querySelector('.chk-tile-label')?.textContent === '도서관');
  ownCheckin.click();
  await sleep(100);
  const walk = actor('sh').getAnimations()[0];
  assert(walk?.playState === 'running', 'The original check-in did not start a walk');
  const afterCheckin = members.map((id) => actor(id).dataset.activity).join();
  button('웅 크루 상태 보기').click();
  await sleep(100);
  assert(selected() === 'wg' && button('웅 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Roster and map selections diverged');
  assert(actor('sh').getAnimations()[0] === walk, 'Selecting a crew member restarted another member’s walk');
  actor('sh').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(50);
  assert(selected() === 'sh' && button('승환 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Keyboard map selection did not reach the roster');
  assert(room.querySelector('.pixel-room-world') === world, 'Selecting a member remounted the world');
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
  report.push('PASS: original study check-in arrives; roster and map keyboard selection preserve the active walk and every check-in');
  document.querySelector('.chk-end').click();
  await sleep(100);
  assert(actor('sh').dataset.activity === 'rest' && document.querySelectorAll('.chk-tile').length === 4, 'Ending study did not restore place choices');
  assert(button('진주 크루 상태 보기').getAttribute('aria-pressed') === 'true', 'Own check-in overwrote the selected crew member');
  assert(!document.querySelector('vite-error-overlay'), 'Vite error overlay present');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Page overflows horizontally');
  assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Local demo called the API');
  report.push('PASS: ending study restores places; other selection and location remain intact; no API calls or page overflow');
  return report;
})()
