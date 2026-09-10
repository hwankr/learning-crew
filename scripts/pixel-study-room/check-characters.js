// Run on a fresh ?pixel-demo=1 page. It checks the actual images and animation timelines.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw Error(message); };
  const gallery = document.querySelector('.pixel-character-gallery');
  const disclosure = gallery.closest('details');
  if (disclosure && !disclosure.open) { disclosure.querySelector('summary').click(); await sleep(100); }
  const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
  const sprites = () => [...gallery.querySelectorAll('.px-sprite-sheet')];
  const results = [];
  const urls = [...new Set(sprites().map((sprite) => sprite.getAttribute('href')))];
  assert(urls.length === 5, 'Crew members do not have distinct assets');
  for (const url of urls) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    assert(bitmap.width === 1152 && bitmap.height === 2688, 'Atlas dimensions are incorrect');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    for (let row = 0; row < 12; row++) for (let col = 0; col < 6; col++) {
      const pixels = context.getImageData(col * 192, row * 224, 192, 224).data;
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) opaque++;
      assert(opaque > 3000 && opaque < 25000, `Missing or opaque-background frame ${url}, ${row}:${col}`);
      assert(pixels[3] === 0, 'Atlas contains a baked-in background');
    }
    bitmap.close();
  }
  results.push('PASS: 5 distinct transparent atlases; all 360 frames contain visible character pixels');

  const count = document.querySelector('.pixel-room-live').textContent;
  for (const [label, clip] of [['산책', 'walk-side'], ['공부', 'study'], ['차 한 모금', 'sip'], ['이야기', 'chat'], ['물 주기', 'water'], ['쉬어가기', 'greet']]) {
    button(gallery, label).click();
    await sleep(70);
    assert([...gallery.querySelectorAll('.px-person')].every((p) => p.dataset.clip === clip), `Incorrect ${label} action`);
    assert(sprites().every((sprite) => sprite.getAnimations().some((a) => a.playState === 'running')), `Static ${label} sprites`);
  }
  button(gallery, '산책').click();
  await sleep(100);
  const framePositions = new Set();
  for (let i = 0; i < 16; i++) { framePositions.add(getComputedStyle(sprites()[0]).transform); await sleep(45); }
  assert(framePositions.size === 6, `Expected six actual gait frames, got ${framePositions.size}`);
  for (const [label, clip, facing] of [['앞모습', 'walk-front', 'south'], ['뒷모습', 'walk-back', 'north'], ['왼쪽', 'walk-side', 'west']]) {
    button(gallery, label).click(); await sleep(60);
    assert([...gallery.querySelectorAll('.px-person')].every((p) => p.dataset.clip === clip && p.dataset.facing === facing), 'Directional frames do not follow the control');
  }
  assert(document.querySelector('.pixel-room-live').textContent === count, 'Preview changed real study status');
  results.push('PASS: every action animates, all 6 gait frames play, directions work, preview preserves check-ins');

  button(gallery, '미리보기 멈춤').click(); await sleep(100);
  const frozen = sprites().map((sprite) => getComputedStyle(sprite).transform);
  await sleep(650);
  assert(sprites().every((sprite, i) => getComputedStyle(sprite).transform === frozen[i]), 'Pause did not freeze exact displayed frames');
  button(gallery, '미리보기 재생').click(); await sleep(140);
  assert(sprites().some((sprite, i) => getComputedStyle(sprite).transform !== frozen[i]), 'Resume did not advance the frames');
  results.push('PASS: preview pauses and resumes the displayed frames');

  const room = document.querySelector('.pixel-room');
  if (room.dataset.autonomous === 'true') button(room, '자율 행동').click();
  await sleep(100);
  button(room, '캐릭터 움직임 끄기').click(); await sleep(100);
  assert(room.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), 'Room pause left an animation running');
  button(document, '승환 도서관에서 공부 시작')?.click(); await sleep(100);
  const actor = document.querySelector('.px-actor[data-member="sh"]');
  assert(actor.dataset.activity === 'library' && actor.querySelector('.px-person').dataset.clip === 'study', 'Paused check-in did not display study frames immediately');
  button(room, '캐릭터 움직임 켜기').click(); await sleep(100);
  const image = actor.querySelector('.px-sprite-sheet');
  const animation = image.getAnimations()[0];
  button(room, '밤 분위기').click(); await sleep(100);
  button(room, '지도 확대').click(); await sleep(100);
  assert(actor.querySelector('.px-sprite-sheet') === image && image.getAnimations()[0] === animation, 'Mood or camera restarted the character cycle');
  results.push('PASS: paused check-in updates the pose; mood and camera preserve sprite animation identity');
  assert(!performance.getEntriesByType('resource').some((r) => new URL(r.name).pathname.startsWith('/api/')), 'Preview called the API');
  return results;
})()
