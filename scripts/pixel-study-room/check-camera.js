// Run on a fresh demo at a desktop viewport with motion enabled.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  const button = (label) => document.querySelector(`button[aria-label="${label}"]`);
  const viewport = document.querySelector('.pixel-map-viewport');
  const world = document.querySelector('.pixel-room-world');
  let moving;
  const deadline = Date.now() + 15_000;
  while (!(moving = world.querySelector('.px-actor[data-moving="true"]'))) {
    assert(Date.now() < deadline, 'No autonomous walk to inspect'); await sleep(40);
  }
  const animation = moving.getAnimations()[0];
  for (let i = 0; i < 2; i++) { button('지도 확대').click(); await sleep(50); }
  assert(viewport.scrollWidth > viewport.clientWidth, 'Zoom did not enlarge the map');
  assert(moving.getAnimations()[0] === animation, 'Zoom restarted an autonomous walk');
  button('웅 캐릭터 보기').click(); button('선택한 크루로 화면 이동').click(); await sleep(50);
  const matrix = world.querySelector('[data-member="wg"]').getScreenCTM();
  const visible = viewport.getBoundingClientRect();
  assert(matrix.e >= visible.left && matrix.e <= visible.right && matrix.f >= visible.top && matrix.f <= visible.bottom, 'Selected member is outside the camera');
  button('지도 전체 보기').click(); await sleep(100);
  const fitted = world.getBoundingClientRect();
  assert(fitted.width <= viewport.clientWidth + 1 && fitted.height <= viewport.clientHeight + 1, 'Full view did not fit both dimensions');
  assert(viewport.scrollWidth <= viewport.clientWidth + 1 && viewport.scrollHeight <= viewport.clientHeight + 1, 'Full view still needs scrolling');
  assert(moving.getAnimations()[0] === animation, 'Camera selection or fit restarted a walk');
  assert(document.documentElement.scrollWidth <= window.innerWidth, 'Map caused page overflow');
  button('지도 확대').click(); await sleep(100);
  return { result: 'PASS', checks: ['zoom enlarges the world', 'focus finds the selected member', 'full view fits width and height', 'camera preserves native travel', 'no page overflow'], dragFrom: { x: Math.round(visible.left + visible.width * .65), y: Math.round(visible.top + visible.height * .65) }, scrollBeforeDrag: [viewport.scrollLeft, viewport.scrollTop] };
})()
