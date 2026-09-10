// A real UI check-in interrupts both participants of an active simulated conversation.
(async () => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(new URLSearchParams(location.search).get('pixel-demo') === '1', 'Use the isolated demo');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (fn) => {
    const end = Date.now() + 20_000;
    while (!fn()) { assert(Date.now() < end, 'Conversation check timed out'); await sleep(50); }
  };
  await wait(() => document.querySelector('.px-speech[data-kind="conversation"]'));
  const pair = [...document.querySelectorAll('.px-actor[data-action="chat"]')];
  const member = pair.find((a) => a.dataset.activity === 'rest');
  assert(member, 'Reload the demo to test a resting member’s first conversation');
  const id = member.dataset.member;
  const name = member.querySelector('.px-name').textContent;
  const partner = pair.find((a) => a !== member);
  document.querySelector(`button[aria-label="${name} 도서관에서 공부 시작"]`).click();
  await sleep(100);
  assert(!document.querySelector('.px-speech[data-kind="conversation"]'), 'An obsolete conversation bubble remained');
  assert(member.dataset.activity === 'library' && member.dataset.action === 'study', 'Check-in did not supersede the conversation');
  assert(partner.dataset.action !== 'chat' && partner.dataset.spot === 'home', 'Partner kept waiting after cancellation');
  await wait(() => member.dataset.phase === 'acting');
  const point = new DOMMatrix(getComputedStyle(member).transform);
  const seats = { sh: [208, 186], wg: [368, 186], th: [528, 186], jj: [264, 282], kj: [472, 282] };
  assert(point.e === seats[id][0] && point.f === seats[id][1], 'Interrupted conversation did not reach the real study seat');
  assert(document.querySelector('.pixel-room-live').textContent === '3명 공부 중', 'Check-in count did not update');
  return { result: 'PASS', member: id, partner: partner.dataset.member, checks: ['active dialogue cancelled immediately', 'partner returned home', 'latest study destination reached', 'study count updated'] };
})()
