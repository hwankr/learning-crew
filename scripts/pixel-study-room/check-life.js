// Run on a fresh standalone demo, then query window.__pixelLifeResult after 90 seconds.
// Observes 85 seconds of ordinary, unprompted activity without holding a long CDP request.
// No fake check-ins, direct state writes, animation.finish(), or accelerated browser clock.
window.__pixelLifeResult = { result: 'RUNNING' };
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  const room = document.querySelector('.pixel-room');
  const world = document.querySelector('.pixel-room-world');
  const actors = () => [...world.querySelectorAll('.px-actor')];
  const actor = (id) => world.querySelector(`[data-member="${id}"]`);
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
  const point = (element) => { const m = new DOMMatrix(getComputedStyle(element).transform); return { x: m.e, y: m.f }; };
  const inLibrary = ({ x, y }) => x > 70 && x < 634 && y < 354;
  const errors = [];
  const onError = (event) => errors.push(String(event.message ?? event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const truth = Object.fromEntries(actors().map((a) => [a.dataset.member, a.dataset.activity]));
  assert(room.dataset.autonomous === 'true', 'Default autonomy must be on');
  assert(document.querySelector('.pixel-room-stage').dataset.motion === 'on', 'Motion must be enabled');
  const actions = new Set();
  const places = new Set();
  const speakers = new Set();
  const lines = new Set();
  let waterVisible = false;
  let pairedConversation = false;
  let walked = false;
  const end = Date.now() + 85_000;
  try {
    while (Date.now() < end) {
      for (const a of actors()) {
        assert(a.dataset.activity === truth[a.dataset.member], 'Autonomous activity changed check-in truth');
        assert(inLibrary(point(a)) === (a.dataset.activity === 'library'), `${a.dataset.member}: crossed the library boundary without a check-in`);
        assert(a.dataset.action !== 'chat' || a.dataset.activity === 'rest', 'A studying member was invited to the garden conversation');
        if (a.dataset.moving === 'true') walked = true;
        if (a.dataset.phase === 'acting') {
          actions.add(a.dataset.action);
          places.add(a.dataset.spot);
        }
        if (a.dataset.action === 'water' && a.dataset.phase === 'acting') {
          const sprite = a.querySelector('.px-person[data-clip="water"] .px-sprite-sheet');
          assert(sprite && sprite.getAttribute('href').includes('-v5.webp'), 'Watering has no illustrated can frames');
          waterVisible = true;
        }
      }
      for (const bubble of world.querySelectorAll('.px-speech[data-kind="conversation"]')) {
        const speaker = bubble.closest('.px-actor');
        const pair = actors().filter((a) => a.dataset.action === 'chat');
        assert(pair.length === 2 && pair.every((a) => a.dataset.phase === 'acting' && a.dataset.moving === 'false'), 'Dialogue began before both people arrived');
        const left = pair.find((a) => a.dataset.spot === 'chat_left');
        const right = pair.find((a) => a.dataset.spot === 'chat_right');
        assert(point(left).x === 736 && point(right).x === 784 && point(left).y === 492 && point(right).y === 492, 'People did not meet at the conversation bay');
        assert(left.querySelector('.px-person').dataset.facing === 'east' && right.querySelector('.px-person').dataset.facing === 'west', 'Conversation partners do not face each other');
        speakers.add(speaker.dataset.member); lines.add(bubble.textContent); pairedConversation = true;
      }
      assert(document.querySelector('.pixel-room-live').textContent === '2명 공부 중', 'Simulation changed the real study count');
      await sleep(200);
    }
    for (const action of ['study', 'rest', 'water', 'read', 'browse', 'coffee', 'wander', 'chat']) assert(actions.has(action), `Did not observe autonomous ${action}`);
    assert(walked && waterVisible && pairedConversation && speakers.size >= 2 && lines.size >= 4, 'Incomplete autonomous story');
    assert(places.has('coffee') && (places.has('tea_left') || places.has('tea_right')), 'Did not brew and drink coffee');

    // Pause an actual in-flight walk, including its virtual clock; resume from the visible position.
    let moving;
    const deadline = Date.now() + 15_000;
    while (!(moving = actors().find((a) => a.dataset.moving === 'true'))) {
      assert(Date.now() < deadline, 'No walk to pause'); await sleep(50);
    }
    const id = moving.dataset.member;
    button('캐릭터 움직임 끄기').click(); await sleep(100);
    const frozen = point(actor(id)); const clock = room.dataset.lifeClock;
    await sleep(1200);
    assert(room.dataset.lifeClock === clock, 'Paused life clock advanced');
    assert(JSON.stringify(point(actor(id))) === JSON.stringify(frozen), 'Paused walk moved');
    assert(world.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), 'Paused decoration continued');
    button('캐릭터 움직임 켜기').click(); await sleep(40);
    assert(Math.hypot(point(actor(id)).x - frozen.x, point(actor(id)).y - frozen.y) < 20, 'Resuming teleported');

    // Hidden tabs have the same freeze policy and do not catch up missed activities.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange')); await sleep(100);
    const hiddenClock = room.dataset.lifeClock;
    await sleep(1200);
    assert(room.dataset.lifeClock === hiddenClock && world.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), 'Hidden tab kept running');
    delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); await sleep(100);
    assert(Number(room.dataset.lifeClock) - Number(hiddenClock) <= 500, 'Hidden tab caught up missed time');

    assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Autonomous demo contacted the API');
    assert(!document.querySelector('vite-error-overlay') && errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
    return { result: 'PASS', observation: '85 seconds at normal speed with no input', actions: [...actions], places: [...places], speakers: [...speakers], dialogueLines: [...lines], checks: ['studying members stay inside the library', 'resting members never enter the library', 'only resting members join garden conversations', 'actual arrivals before dialogue', 'watering tool visible', 'brew and sip', 'truthful check-in count', 'pause and resume', 'hidden clock frozen', 'no API or runtime errors'] };
  } finally {
    delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onError);
  }
})().then((result) => { window.__pixelLifeResult = result; }, (error) => {
  window.__pixelLifeResult = { result: 'FAIL', error: String(error), stack: error.stack };
});
'Observing autonomous life; query window.__pixelLifeResult after 90 seconds.'
