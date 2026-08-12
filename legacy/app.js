/* 러닝 크루 — 4인 스터디 크루의 하루 기록 보드.
   디자인 원본: claude.ai/design 프로젝트의 「러닝 크루.dc.html」 프로토타입 포팅.
   의존성 없는 정적 앱: 상태 → DOM 트리 생성 → 기존 DOM에 morph. */
(() => {
'use strict';

// ---------- 크루 ----------
const MEMBERS = [
  { id: 'sh', name: '승환', color: '#FFB800', soft: '#FFF0BF', hairC: '#23262E',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-3.5-6-7-8.5-12.5-8.5s-9 2.5-12.5 8.5z' },
  { id: 'wg', name: '웅', color: '#12B76A', soft: '#C9F2DE', hairC: '#16181D',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0l-2.6-3.8-2.7 2.3-2.2-3.8-2.8 2.8-2.7-4.2-2.3 3.9-2.8-2.3-2 3.3z' },
  { id: 'th', name: '태현', color: '#2E90FA', soft: '#CFE5FE', hairC: '#4E555F',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-1.3-4.2-3-6.8-5.7-7.9-3.8 2.2-9.2 2.1-12.6-.2-3.4 1.6-5.5 4.3-6.7 8.1z' },
  { id: 'jj', name: '진주', color: '#F79009', soft: '#FCE1BD', hairC: '#363B45',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-3.5-6-7-8.5-12.5-8.5s-9 2.5-12.5 8.5zM7.5 18a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0zM34.1 18a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0z' },
];
const BY_ID = Object.fromEntries(MEMBERS.map((m) => [m.id, m]));

// ---------- 태그 ----------
const TAGS = ['자격증', '영어', '코딩테스트', '기타', 'OFF'];
const TAGMETA = {
  '자격증': { icon: 'M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm-3.5 9.5L7 21l5-3 5 3-1.5-8.5', bg: '#FFF9E6', fg: '#B37F00' },
  '영어': { icon: 'M8 9.5h8M8 13h5M21 12c0 4.4-4 8-9 8-1.1 0-2.1-.1-3.1-.4L4 21l1.5-4.2A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z', bg: '#E7F1FF', fg: '#14579F' },
  '코딩테스트': { icon: 'M8 6l-6 6 6 6M16 6l6 6-6 6', bg: '#E6F9F0', fg: '#0A6E42' },
  '기타': { icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', bg: '#F1F3F6', fg: '#4E555F' },
  'OFF': { icon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z', bg: '#F1F3F6', fg: '#6B7280' },
};

// ---------- 카피 (은은한 위트 / 낄낄 풀드립) ----------
const COPY = {
  subtle: {
    greeting: '오늘도 조용히 성장 중',
    cta: '오늘 기록 남기기', ctaNone: '아직 오늘 기록이 없어요', ctaSome: (n) => '오늘 ' + n + '개 남겼어요. 하나 더?',
    memoPh: '오늘 한 줄, 남겨볼까요?', modalHint: '한 줄이면 충분해요. 일기나 할 일 목록을 붙여도 좋고요.',
    diaryPh: '오늘 있었던 일, 편하게 풀어놓아요.', todoPh: '할 일 내용',
    submit: '기록 남기기', editSubmit: '수정 저장',
    empty: '아직 안 옴', emptyMe: '오늘 첫 기록을 남겨보세요',
    offNote: '쉬는 날은 별점 없이 기록돼요.',
    footer: '오늘도 크루 중 누군가는 공부를 합니다.',
    caps: ['별점을 골라주세요', '…내일이 있으니까요', '시동은 걸었어요', '무난하게 순항 중', '오늘 좀 했는데요?', '이 구역의 공부왕'],
    count: (n) => '4명 중 ' + n + '명 도장 찍음',
    calEmpty: '이 날은 다들 조용했네요.',
  },
  drip: {
    greeting: '뇌 용량 증설 공사 중',
    cta: '오늘 기록 남기기', ctaNone: '오늘 아직 0개. 크루가 지켜봅니다', ctaSome: (n) => '오늘 ' + n + '개째. 멈추지 마세요',
    memoPh: '변명이든 자랑이든 한 줄', modalHint: '어차피 크루는 다 알아봅니다. 솔직하게.',
    diaryPh: '오늘의 서사, 마음껏 펼치세요.', todoPh: '뭘 하려고 했더라',
    submit: '박제하기', editSubmit: '변명 수정',
    empty: '잠수 중', emptyMe: '본인 도장부터 찍으시죠?',
    offNote: '공식 휴무. 죄책감은 반납하세요.',
    footer: '공부는 원래 남이 하는 게 제일 재밌습니다.',
    caps: ['별점을 골라주세요', '별점이 아깝다는 건 아니고', '한 듯 안 한 듯', '평타는 쳤다', '꽤 진지했잖아요?', '수석 각'],
    count: (n) => '4명 중 ' + n + '명 생존 신고',
    calEmpty: '전원 잠수한 날이네요.',
  },
};

// ---------- 설정 (URL 파라미터: ?user=웅&wit=drip&view=cal) ----------
const params = new URLSearchParams(location.search);
const me = MEMBERS.find((m) => m.name === params.get('user')) || MEMBERS[0];
const wit = ['drip', '낄낄 풀드립'].includes(params.get('wit')) ? COPY.drip : COPY.subtle;
const defaultView = ['cal', '캘린더'].includes(params.get('view')) ? 'cal' : 'feed';

// ---------- 저장 ----------
const KEY = 'running-crew-entries-v2';
const OLDKEY = 'running-crew-entries-v1';
const W = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function shiftKey(days) { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d); }

function seed() {
  const t = shiftKey(0), y = shiftKey(-1), b = shiftKey(-2);
  return [
    { id: 's1', m: 'wg', day: t, time: '09:40', tag: '코딩테스트', stars: 4, memo: '오전 스퍼트 완료',
      todos: [{ t: '그리디 3문제', done: true }, { t: 'DP 복습 1문제', done: true }, { t: '오답노트 정리', done: false }] },
    { id: 's2', m: 'jj', day: t, time: '13:12', tag: '영어', stars: 3, memo: '쉐도잉 20분',
      body: '혀가 먼저 퇴근했다.\n내일은 발음 교정 영상 보고 재도전. 그래도 오늘 표현 3개는 건짐 — at stake, for good, hold up.' },
    { id: 's3', m: 'sh', day: y, time: '22:05', tag: '자격증', stars: 5, memo: '기출 1회분 클리어. 오늘만큼은 천재' },
    { id: 's4', m: 'jj', day: y, time: '21:47', tag: '코딩테스트', stars: 4, memo: 'DFS가 드디어 손에 붙음' },
    { id: 's5', m: 'wg', day: y, time: '20:11', tag: '영어', stars: 2, memo: '단어 데이',
      todos: [{ t: '단어 30개 암기', done: true }, { t: '복습 테스트', done: false }] },
    { id: 's6', m: 'th', day: y, time: '11:30', tag: 'OFF', stars: null, memo: '재충전의 날. 침대와 물아일체' },
    { id: 's7', m: 'sh', day: b, time: '23:59', tag: '코딩테스트', stars: 2, memo: 'DP는 대체 누가 만들었을까' },
    { id: 's8', m: 'th', day: b, time: '19:02', tag: '영어', stars: 4, memo: '자막 없이 미드 완주',
      body: '한 편을 자막 없이 봤다. 절반은 뉘앙스로 때려 맞혔지만, 그것도 실력이라고 우기기로 함.' },
    { id: 's9', m: 'jj', day: b, time: '15:20', tag: '자격증', stars: 3, memo: '요약노트 정리. 손목이 아파요' },
  ];
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) return v; }
  } catch (e) {}
  let userMade = [];
  try {
    const old = localStorage.getItem(OLDKEY);
    if (old) { const v = JSON.parse(old); if (Array.isArray(v)) userMade = v.filter((e) => e && String(e.id).charAt(0) === 'e'); }
  } catch (e) {}
  return seed().concat(userMade);
}

// ---------- 상태 ----------
const state = {
  entries: load(),
  tag: null, stars: 0, memo: '', body: '', todos: [], mode: 'plain',
  editingId: null, modalOpen: false,
  view: defaultView, calOff: 0, selDay: null,
};
let pendingFocus = null;

function setState(patch, focus) {
  Object.assign(state, patch);
  if (focus) pendingFocus = focus;
  render();
}

function commit(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  setState({ entries: list });
}

// ---------- DOM 헬퍼 ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const PROP_KEYS = new Set(['value', 'checked', 'maxLength', 'rows', 'placeholder']);

function make(ns, tag, attrs, kids) {
  const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el[k] = v;
    else if (k === 'style') el.style.cssText = v;
    else if (!ns && PROP_KEYS.has(k)) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}
const h = (t, a, ...k) => make(null, t, a, k);
const s = (t, a, ...k) => make(SVG_NS, t, a, k);

/* 기존 DOM을 새 트리 모양으로 맞춘다(요소 identity 유지 → CSS 트랜지션·포커스·스크롤 보존). */
const HANDLERS = ['onclick', 'oninput', 'onkeydown'];
function morph(o, n) {
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  for (const p of HANDLERS) o[p] = n[p];
  const t = o.tagName;
  if ((t === 'INPUT' || t === 'TEXTAREA') && o !== document.activeElement && o.value !== n.value) o.value = n.value;
  morphChildren(o, n);
}
function morphChildren(o, n) {
  const oc = [...o.childNodes], nc = [...n.childNodes];
  for (let i = 0; i < Math.max(oc.length, nc.length); i++) {
    const a = oc[i], b = nc[i];
    if (!a && b) o.append(b);
    else if (a && !b) a.remove();
    else if (a.nodeType === 3 && b.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; }
    else if (a.nodeType === 1 && b.nodeType === 1 && a.tagName === b.tagName) morph(a, b);
    else a.replaceWith(b);
  }
}

// ---------- 조립 파츠 ----------
function icon(d, size, sw) {
  return s('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:block;flex:none' },
    s('path', { d }));
}

function avatarSvg(m, size, opts = {}) {
  const ring = opts.ring || m.color;
  let style = 'display:block;flex:none';
  if (opts.opacity) style += ';opacity:' + opts.opacity;
  if (opts.bg) style += ';background:' + opts.bg;
  return s('svg', { width: size, height: size, viewBox: '0 0 48 48', class: opts.cls || null, style },
    s('circle', { cx: 24, cy: 24, r: 21.5, fill: m.soft, stroke: ring, 'stroke-width': 3, 'stroke-dasharray': opts.dash || '0' }),
    s('circle', { cx: 24, cy: 27, r: 12.5, fill: '#F6D7BC' }),
    s('path', { d: m.hair, fill: m.hairC }),
    s('circle', { cx: 19.5, cy: 27.5, r: 1.6, fill: '#23262E' }),
    s('circle', { cx: 28.5, cy: 27.5, r: 1.6, fill: '#23262E' }),
    s('path', { d: 'M20.5 31.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8', stroke: '#23262E', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }));
}

const STAR_D = 'M12 2.6l2.9 5.9 6.5 1-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-1z';
function starsSvg(n, w, hgt) {
  return s('svg', { width: w, height: hgt, viewBox: '0 0 120 24', style: 'display:block' },
    [0, 1, 2, 3, 4].map((i) => s('path', { d: STAR_D, transform: i ? 'translate(' + i * 24 + ' 0)' : null, fill: i < n ? '#FFB800' : '#E4E7EC' })));
}

const CHIP_SIZES = { xs: { icon: 10, cls: 'chip chip-xs' }, sm: { icon: 11, cls: 'chip chip-sm' }, sm2: { icon: 10, cls: 'chip chip-sm' }, md: { icon: 11, cls: 'chip chip-md' } };
function chipEl(tag, variant) {
  const tm = TAGMETA[tag] || TAGMETA['기타'];
  const v = CHIP_SIZES[variant];
  return h('span', { class: v.cls, style: 'background:' + tm.bg + ';color:' + tm.fg },
    icon(tm.icon, v.icon, 2.4),
    h('span', { class: 'chip-label' }, tag));
}

const CHECK_D = 'M20 6 9 17l-5-5';
function checkSvg(size) {
  return s('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: '#16181D',
    'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:block' },
    s('path', { d: CHECK_D }));
}

function meBadge(sm) {
  return h('span', { class: 'me-badge' + (sm ? ' sm' : '') }, '나');
}

// ---------- 모달 동작 ----------
function resetModalState() {
  return { tag: null, stars: 0, memo: '', body: '', todos: [], mode: 'plain', editingId: null };
}
function openNew() {
  setState({ modalOpen: true, ...resetModalState() }, 'memo');
}
function closeModal() {
  setState({ modalOpen: false, ...resetModalState() });
}
function canSubmit() {
  return !!state.tag && (state.tag === 'OFF' || state.stars > 0);
}
function submit() {
  if (!canSubmit()) return;
  const isOff = state.tag === 'OFF';
  const cleanTodos = state.mode === 'todo' ? state.todos.filter((t) => t.t.trim()).map((t) => ({ t: t.t.trim(), done: !!t.done })) : [];
  const cleanBody = state.mode === 'diary' ? state.body.trim() : '';
  const list = state.entries.slice();
  if (state.editingId) {
    const i = list.findIndex((e) => e.id === state.editingId);
    if (i >= 0) list[i] = { ...list[i], tag: state.tag, stars: isOff ? null : state.stars, memo: state.memo.trim(), body: cleanBody, todos: cleanTodos };
  } else {
    const now = new Date();
    list.push({
      id: 'e' + Date.now(), m: me.id, day: dayKey(now),
      time: pad2(now.getHours()) + ':' + pad2(now.getMinutes()),
      tag: state.tag, stars: isOff ? null : state.stars, memo: state.memo.trim(), body: cleanBody, todos: cleanTodos,
    });
  }
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  setState({ entries: list, modalOpen: false, ...resetModalState() });
}

// ---------- 엔트리 행 (피드 / 캘린더 하단 공용) ----------
function entryEl(e, compact) {
  const mm = BY_ID[e.m] || MEMBERS[0];
  const todos = Array.isArray(e.todos) ? e.todos : [];
  const body = e.body || '';
  const memo = e.memo || '';
  const mine = e.m === me.id;
  const hasStars = e.tag !== 'OFF' && e.stars > 0;
  const doneN = todos.filter((t) => t.done).length;
  const editing = e.id === state.editingId;

  const startEdit = () => setState({
    modalOpen: true, editingId: e.id, tag: e.tag, stars: e.stars || 0, memo,
    body, todos: todos.map((t) => ({ ...t })),
    mode: todos.length ? 'todo' : body ? 'diary' : 'plain',
  }, 'memo');
  const del = () => commit(state.entries.filter((x) => x.id !== e.id));
  const toggleTodo = (ti) => commit(state.entries.map((x) => x.id === e.id
    ? { ...x, todos: x.todos.map((tt, j) => j === ti ? { ...tt, done: !tt.done } : tt) }
    : x));

  const todoList = todos.length ? h('div', { class: 'entry-todos' },
    todos.map((t, ti) => h('div', { class: 'todo-line' },
      h('button', {
        class: 'todo-check' + (t.done ? ' done' : '') + (mine ? ' tappable' : ''),
        onclick: mine ? () => toggleTodo(ti) : null,
      }, checkSvg(compact ? 10 : 11)),
      h('span', { class: 'todo-text' + (t.done ? ' done' : '') }, t.t)))) : null;

  const memoEl = memo ? h('div', { class: 'entry-memo', style: 'font-weight:' + (body || todos.length ? '700' : '400') }, memo) : null;
  const bodyEl = body ? h('div', { class: 'entry-body' }, body) : null;

  const head = compact
    ? h('div', { class: 'entry-head' },
        h('span', { class: 'entry-name' }, mm.name),
        h('span', { class: 'entry-time' }, e.time),
        h('span', { class: 'spacer' }),
        chipEl(e.tag, 'sm2'),
        hasStars ? starsSvg(e.stars, 55, 11) : null)
    : h('div', { class: 'entry-head' },
        h('span', { class: 'entry-name' }, mm.name),
        h('span', { class: 'entry-time' }, e.time),
        h('span', { class: 'spacer' }),
        mine ? h('div', { class: 'entry-actions' },
          h('button', { class: 'entry-act edit', onclick: startEdit }, '수정'),
          h('button', { class: 'entry-act del', onclick: del }, '삭제')) : null);

  const tagRow = compact ? null : h('div', { class: 'entry-tags' },
    chipEl(e.tag, 'md'),
    hasStars ? starsSvg(e.stars, 70, 14) : null,
    todos.length ? h('span', { class: 'todo-count' }, doneN + '/' + todos.length) : null);

  return h('div', { class: 'entry' + (compact ? ' compact' : '') + (editing ? ' editing' : '') },
    avatarSvg(mm, compact ? 36 : 40),
    h('div', { class: 'entry-main' }, head, tagRow, memoEl, bodyEl, todoList));
}

// ---------- 오늘의 크루 보드 ----------
function boardCellEl(m, todays) {
  const mine = todays.filter((e) => e.m === m.id).sort((a, b) => b.time.localeCompare(a.time));
  const latest = mine[0];
  const isMe = m.id === me.id;
  const ring = latest ? m.color : '#CDD2DB';
  const dash = latest ? '0' : '5 4';
  const opacity = latest ? null : '0.55';
  const hasStars = !!latest && latest.tag !== 'OFF' && latest.stars > 0;
  const firstTodo = latest && Array.isArray(latest.todos) && latest.todos.length ? latest.todos[0].t : '';
  const subLine = latest
    ? (latest.memo || firstTodo || (latest.body || '').split('\n')[0] || (latest.tag === 'OFF' ? '오늘은 휴식' : ''))
    : (isMe ? wit.emptyMe : wit.empty);
  const extra = mine.length > 1 ? '외 ' + (mine.length - 1) + '개' : '';

  const strip = h('div', { class: 'board-strip' },
    avatarSvg(m, 46, { ring, dash, opacity }),
    h('div', { class: 'board-strip-name' }, h('span', null, m.name), isMe ? meBadge(false) : null),
    latest
      ? h('div', { class: 'board-strip-entry' },
          chipEl(latest.tag, 'xs'),
          hasStars ? starsSvg(latest.stars, 55, 11) : null,
          latest.tag === 'OFF' ? h('span', { class: 'board-strip-off' }, '오늘은 휴식') : null)
      : h('span', { class: 'board-strip-empty' }, wit.empty));

  const row = h('div', { class: 'board-row' },
    avatarSvg(m, 40, { ring, dash, opacity }),
    h('div', { class: 'board-row-main' },
      h('div', { class: 'board-row-name' },
        h('span', { class: 'board-row-nm' }, m.name),
        isMe ? meBadge(true) : null,
        extra ? h('span', { class: 'board-row-extra' }, extra) : null),
      h('div', { class: 'board-row-sub' }, subLine)),
    latest ? h('div', { class: 'board-row-right' },
      chipEl(latest.tag, 'sm'),
      hasStars ? starsSvg(latest.stars, 60, 12) : null) : null);

  return h('div', { class: 'board-cell' }, strip, row);
}

// ---------- 피드 ----------
function feedViewEl(todayKey, yKey) {
  const dayLabel = (k) => {
    if (k === todayKey) return '오늘';
    if (k === yKey) return '어제';
    const d = new Date(k + 'T12:00:00');
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + W[d.getDay()] + ')';
  };
  const keys = [...new Set(state.entries.map((e) => e.day))].sort().reverse();
  return h('div', null, keys.map((k) => h('div', null,
    h('div', { class: 'group-head' },
      h('span', { class: 'group-label' }, dayLabel(k)),
      h('span', { class: 'group-line' })),
    h('div', null,
      state.entries.filter((e) => e.day === k)
        .sort((a, b) => b.time.localeCompare(a.time))
        .map((e) => entryEl(e, false))))));
}

// ---------- 캘린더 ----------
function calViewEl(now, todayKey, selDay) {
  const calBase = new Date(now.getFullYear(), now.getMonth() + state.calOff, 1);
  const daysIn = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 0).getDate();
  const lead = calBase.getDay();
  const byDay = {};
  state.entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || new Set()).add(e.m); });

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('button', { class: 'cal-cell', style: 'visibility:hidden' }));
  for (let n = 1; n <= daysIn; n++) {
    const k = dayKey(new Date(calBase.getFullYear(), calBase.getMonth(), n));
    const isToday = k === todayKey, isSel = k === selDay, isFuture = k > todayKey;
    const dots = MEMBERS.filter((m) => byDay[k] && byDay[k].has(m.id));
    cells.push(h('button', {
      class: 'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : ''),
      onclick: () => setState({ selDay: k }),
    },
      h('span', { class: 'cal-num' }, String(n)),
      h('span', { class: 'cal-day-dots' },
        dots.map((m) => h('span', { class: 'cal-day-dot', style: 'background:' + m.color })))));
  }

  const selList = state.entries.filter((e) => e.day === selDay).sort((a, b) => b.time.localeCompare(a.time));
  const selD = new Date(selDay + 'T12:00:00');

  return h('div', null,
    h('div', { class: 'cal-head' },
      h('div', { class: 'cal-title' }, calBase.getFullYear() + '년 ' + (calBase.getMonth() + 1) + '월'),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', onclick: () => setState({ calOff: state.calOff - 1 }) }, icon('M15 6l-6 6 6 6', 17, 2.4)),
        h('button', { class: 'icon-btn', onclick: () => setState({ calOff: state.calOff + 1 }) }, icon('M9 6l6 6-6 6', 17, 2.4)))),
    h('div', { class: 'cal-week' },
      W.map((d, i) => h('span', { class: 'cal-wd' + (i === 0 ? ' sun' : '') }, d))),
    h('div', { class: 'cal-grid' }, cells),
    h('div', { class: 'sel-head' },
      h('span', { class: 'sel-label' }, (selD.getMonth() + 1) + '월 ' + selD.getDate() + '일 (' + W[selD.getDay()] + ') · ' + selList.length + '개'),
      h('span', { class: 'group-line' })),
    selList.length === 0 ? h('div', { class: 'sel-empty' }, wit.calEmpty) : null,
    h('div', null, selList.map((e) => entryEl(e, true))));
}

// ---------- 기록 모달 ----------
function modalEl(now, editingId) {
  const isOff = state.tag === 'OFF';
  const ready = canSubmit();

  const todoRows = state.todos.map((t, i) => h('div', { class: 'modal-todo-row' },
    h('button', {
      class: 'todo-check modal-check' + (t.done ? ' done' : ''),
      onclick: () => setState({ todos: state.todos.map((x, j) => j === i ? { ...x, done: !x.done } : x) }),
    }, checkSvg(12)),
    h('input', {
      class: 'modal-todo-input' + (t.done ? ' done' : ''),
      value: t.t, placeholder: wit.todoPh,
      oninput: (ev) => { state.todos[i] = { ...state.todos[i], t: ev.target.value }; },
      onkeydown: (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        if (i === state.todos.length - 1 && state.todos[i].t.trim()) setState({ todos: [...state.todos, { t: '', done: false }] }, 'todo-last');
      },
    }),
    h('button', {
      class: 'modal-todo-remove',
      onclick: () => setState({ todos: state.todos.filter((x, j) => j !== i) }),
    }, icon('M6 6l12 12M18 6L6 18', 13, 2.4))));

  return h('div', { class: 'overlay', onclick: closeModal },
    h('div', { class: 'sheet', onclick: (ev) => ev.stopPropagation() },
      h('div', { class: 'sheet-head' },
        h('span', { class: 'sheet-date' },
          (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' + W[now.getDay()] + '요일' + (editingId ? ' · 수정 중' : ' · 오늘')),
        h('button', { class: 'icon-btn sheet-close', onclick: closeModal }, icon('M6 6l12 12M18 6L6 18', 17, 2.4))),
      h('input', {
        class: 'modal-memo', value: state.memo, placeholder: wit.memoPh, maxLength: 60,
        oninput: (ev) => { state.memo = ev.target.value; },
        onkeydown: (ev) => { if (ev.key === 'Enter' && state.mode === 'plain') submit(); },
      }),
      h('div', { class: 'modal-hint' }, wit.modalHint),
      h('div', { class: 'mode-row' },
        h('button', {
          class: 'mode-btn' + (state.mode === 'diary' ? ' on' : ''),
          onclick: () => setState({ mode: state.mode === 'diary' ? 'plain' : 'diary' }),
        }, icon('M4 6h16M4 12h10M4 18h14', 13, 2.2), h('span', null, '일기 쓰기')),
        h('button', {
          class: 'mode-btn' + (state.mode === 'todo' ? ' on' : ''),
          onclick: () => {
            const entering = state.mode !== 'todo';
            setState({ mode: entering ? 'todo' : 'plain', todos: state.todos.length ? state.todos : [{ t: '', done: false }] },
              entering ? 'todo-last' : null);
          },
        }, icon('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', 13, 2.2), h('span', null, '할 일 목록'))),
      state.mode === 'diary' ? h('textarea', {
        class: 'modal-diary', rows: 5, value: state.body, placeholder: wit.diaryPh,
        oninput: (ev) => { state.body = ev.target.value; },
      }) : null,
      state.mode === 'todo' ? h('div', { class: 'modal-todos' },
        todoRows,
        h('button', { class: 'add-todo', onclick: () => setState({ todos: [...state.todos, { t: '', done: false }] }, 'todo-last') },
          icon('M12 5v14M5 12h14', 13, 2.4), h('span', null, '항목 추가'))) : null,
      h('div', { class: 'modal-sec' },
        h('span', { class: 'sec-label pt' }, icon('M12 2l8 5v10l-8 5-8-5V7z', 13, 2), h('span', null, '태그')),
        h('div', { class: 'tag-chips' },
          TAGS.map((t) => {
            const on = state.tag === t;
            const tm = TAGMETA[t];
            return h('button', {
              class: 'tag-chip',
              style: on ? 'background:' + tm.bg + ';color:' + tm.fg + ';border-color:' + tm.fg : null,
              onclick: () => setState({ tag: on ? null : t }),
            }, icon(tm.icon, 14, 2), h('span', null, t));
          }))),
      h('div', { class: 'modal-sec center' },
        h('span', { class: 'sec-label' },
          s('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'display:block' },
            s('path', { d: STAR_D })),
          h('span', null, '별점')),
        !isOff
          ? h('div', { class: 'star-row' },
              [1, 2, 3, 4, 5].map((n) => h('button', { class: 'star-btn', onclick: () => setState({ stars: n }) },
                s('svg', { width: 30, height: 30, viewBox: '0 0 24 24', style: 'display:block' },
                  s('path', { d: STAR_D, fill: n <= state.stars ? '#FFB800' : '#E4E7EC' })))),
              h('span', { class: 'star-cap' }, wit.caps[state.stars] || wit.caps[0]))
          : h('span', { class: 'off-note' }, wit.offNote)),
      h('button', { class: 'submit' + (ready ? ' ready' : ''), onclick: submit },
        editingId ? wit.editSubmit : wit.submit)));
}

// ---------- 렌더 ----------
function render() {
  const now = new Date();
  const todayKey = dayKey(now), yKey = shiftKey(-1);
  const selDay = state.selDay ?? todayKey;
  const todays = state.entries.filter((e) => e.day === todayKey);
  const doneSet = new Set(todays.map((e) => e.m));
  const myToday = todays.filter((e) => e.m === me.id).length;

  const left = h('div', { class: 'left' },
    h('div', { class: 'brand-row' },
      h('div', { class: 'brand' }, '러닝 크루 👟'),
      h('div', { class: 'stack' }, MEMBERS.map((m) => avatarSvg(m, 36, { cls: 'stack-av', bg: m.soft })))),
    h('div', { class: 'sub' },
      (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' + W[now.getDay()] + '요일 · ' + wit.greeting),
    h('button', { class: 'cta', onclick: openNew },
      icon('M12 5v14M5 12h14', 17, 2.6), h('span', null, wit.cta)),
    h('div', { class: 'cta-cap' }, myToday > 0 ? wit.ctaSome(myToday) : wit.ctaNone),
    h('div', { class: 'board-head' },
      h('div', { class: 'board-title' }, '오늘의 크루'),
      h('div', { class: 'board-meta' },
        h('div', { class: 'board-dots' },
          MEMBERS.map((m) => h('span', { class: 'board-dot', style: 'background:' + (doneSet.has(m.id) ? m.color : '#E4E7EC') }))),
        h('span', { class: 'board-count' }, wit.count(doneSet.size)))),
    h('div', { class: 'board' }, MEMBERS.map((m) => boardCellEl(m, todays))));

  const feed = h('div', { class: 'feed-col' },
    h('div', { class: 'tabs' },
      h('button', { class: 'tab' + (state.view === 'feed' ? ' on' : ''), onclick: () => setState({ view: 'feed' }) }, '피드'),
      h('button', { class: 'tab' + (state.view === 'cal' ? ' on' : ''), onclick: () => setState({ view: 'cal' }) }, '캘린더')),
    state.view === 'feed' ? feedViewEl(todayKey, yKey) : calViewEl(now, todayKey, selDay),
    h('div', { class: 'footer' }, wit.footer));

  const next = h('div', null,
    h('div', { class: 'screen' }, h('div', { class: 'shell' }, left, feed)),
    state.modalOpen ? modalEl(now, state.editingId) : null);

  morphChildren(document.getElementById('app'), next);
  applyFocus();
}

function applyFocus() {
  if (!pendingFocus) return;
  let el = null;
  if (pendingFocus === 'memo') el = document.querySelector('.modal-memo');
  else if (pendingFocus === 'todo-last') {
    const list = document.querySelectorAll('.modal-todo-input');
    el = list[list.length - 1];
  }
  pendingFocus = null;
  if (el) {
    el.focus();
    if (el.setSelectionRange) { const n = el.value.length; el.setSelectionRange(n, n); }
  }
}

render();
})();
