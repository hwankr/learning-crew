import { MEMBER_IDS, MEMBER_NAMES, isOffTags, normalizeTags, primaryTag } from '../../shared/types';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
  Notification,
  Place,
  ReactionSet,
  Tag,
} from '../../shared/types';

export interface Member {
  id: MemberId;
  name: string;
  color: string;
  soft: string;
  hairC: string;
  hair: string;
}

export const MEMBERS: Member[] = [
  { id: 'sh', name: MEMBER_NAMES.sh, color: '#FFB800', soft: '#FFF0BF', hairC: '#23262E',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-3.5-6-7-8.5-12.5-8.5s-9 2.5-12.5 8.5z' },
  { id: 'wg', name: MEMBER_NAMES.wg, color: '#12B76A', soft: '#C9F2DE', hairC: '#16181D',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0l-2.6-3.8-2.7 2.3-2.2-3.8-2.8 2.8-2.7-4.2-2.3 3.9-2.8-2.3-2 3.3z' },
  { id: 'th', name: MEMBER_NAMES.th, color: '#2E90FA', soft: '#CFE5FE', hairC: '#4E555F',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-1.3-4.2-3-6.8-5.7-7.9-3.8 2.2-9.2 2.1-12.6-.2-3.4 1.6-5.5 4.3-6.7 8.1z' },
  { id: 'jj', name: MEMBER_NAMES.jj, color: '#F79009', soft: '#FCE1BD', hairC: '#363B45',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-3.5-6-7-8.5-12.5-8.5s-9 2.5-12.5 8.5zM7.5 18a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0zM34.1 18a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0z' },
  // 경진 — 윗머리 반원 + 얼굴 양옆으로 턱 아래까지 흘러내리는 긴 생머리.
  // 안쪽 가장자리는 x≈14.8/33.2에서 시작해 눈(19.5·28.5)·입(20.5~27.5)을 덮지 않고,
  // 바깥쪽은 아바타 원(cx24 cy24 r21.5) 안에 머문다(최대 반경 ≈20.2).
  { id: 'kj', name: MEMBER_NAMES.kj, color: '#9E77ED', soft: '#E9D7FE', hairC: '#3B2F45',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c1.4 4.5 1.1 9-.5 13.2-1.4.6-2.7.2-3.6-.8 1.2-3.8 1.5-8 .8-12-1.6-4.4-4.8-6.8-9.2-6.8s-7.6 2.4-9.2 6.8c-.7 4-.4 8.2.8 12-.9 1-2.2 1.4-3.6.8-1.6-4.2-1.9-8.7-.5-13.2z' },
];

export const BY_ID: Record<MemberId, Member> = Object.fromEntries(MEMBERS.map((m) => [m.id, m])) as Record<
  MemberId,
  Member
>;

/** 모르는 멤버 id의 중립 표시 이름 — 사람 이름 자리에 들어가도 어색하지 않은 총칭. */
export const UNKNOWN_MEMBER_NAME = '크루원';

/* 크루에 사람이 늘면, 배포 직후에도 열려 있는 구버전 번들은 그 사람을 모른 채 20초마다
   그 사람의 기록·댓글을 계속 받는다(내비게이션은 네트워크 우선이라 새로고침만 하면 새
   번들이 되지만, 열어 둔 탭은 그 사이 계속 폴링한다). 그때 MEMBERS[0]으로 폴백하면
   남의 기록이 승환의 이름·색·아바타로 표시된다 — 잘못된 사람에게 귀속시키는 것보다
   "모른다"고 말하는 쪽이 안전하다. 회색은 크루 다섯 색(옐로·그린·블루·오렌지·보라)
   어느 것과도 겹치지 않아서 누구의 색도 주장하지 않는다. */
const UNKNOWN_LOOK: Omit<Member, 'id'> = {
  name: UNKNOWN_MEMBER_NAME,
  color: '#9AA1AD',
  soft: '#F1F3F6',
  hairC: '#6B7280',
  // 특징 없는 반원 — 다섯 명의 머리 모양 중 어느 것으로도 안 읽혀야 한다
  hair: 'M11.5 27a12.5 12.5 0 0 1 25 0z',
};

/** 표시용 멤버 조회 — BY_ID는 타입만 완전하고(`as Record`) 런타임은 그렇지 않다.
    화면에 사람을 그리는 자리는 전부 이걸 지나야 한다. */
export function memberOf(id: MemberId): Member {
  return BY_ID[id] ?? { id, ...UNKNOWN_LOOK };
}

/** 표시용 이름 조회 — MEMBER_NAMES도 같은 이유로 런타임에 빈칸이 될 수 있다. */
export function memberName(id: MemberId): string {
  return MEMBER_NAMES[id] ?? UNKNOWN_MEMBER_NAME;
}

/** 이 기록들을 남긴 멤버 목록 — 명부가 아니라 기록에서 뽑는다.
    명부(MEMBERS)에서 출발해 거르면 이 번들이 모르는 멤버의 기록은 통째로 탈락한다.
    캘린더 월간 셀은 그 날에 기록이 있다는 유일한 표시가 색 점이라, 모르는 멤버만
    기록한 날이 "아무도 기록 안 한 날"로 읽힌다(같은 셀의 알약은 memberOf로 보이므로
    같은 데이터가 알약에는 있고 점에는 없는 불일치까지 생긴다).
    순서: 아는 멤버가 MEMBER_IDS 고정 순서로 먼저, 모르는 id는 그 뒤에 처음 등장한
    순서로. 화면에서 사람을 찾는 기준이 크루 순서라 그 앞부분은 흔들리면 안 된다. */
export function membersOfEntries(list: readonly { m: MemberId }[]): Member[] {
  const seen = new Set<MemberId>();
  const unknown: MemberId[] = [];
  for (const e of list) {
    if (seen.has(e.m)) continue; // 같은 사람의 기록이 여럿이어도 한 번만
    seen.add(e.m);
    if (!MEMBER_IDS.includes(e.m)) unknown.push(e.m);
  }
  return [...MEMBER_IDS.filter((id) => seen.has(id)), ...unknown].map(memberOf);
}

export const TAGMETA: Record<Tag, { icon: string; bg: string; fg: string }> = {
  '자격증': { icon: 'M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm-3.5 9.5L7 21l5-3 5 3-1.5-8.5', bg: '#FFF9E6', fg: '#B37F00' },
  '영어': { icon: 'M8 9.5h8M8 13h5M21 12c0 4.4-4 8-9 8-1.1 0-2.1-.1-3.1-.4L4 21l1.5-4.2A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z', bg: '#E7F1FF', fg: '#14579F' },
  '코딩테스트': { icon: 'M8 6l-6 6 6 6M16 6l6 6-6 6', bg: '#E6F9F0', fg: '#0A6E42' },
  '기타': { icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', bg: '#F1F3F6', fg: '#4E555F' },
  'OFF': { icon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z', bg: '#F1F3F6', fg: '#6B7280' },
};

export const PLACE_ICON: Record<Place, string> = {
  '도서관': '📚',
  '집': '🏠',
  '카페': '☕',
  '기타': '📍',
};

/** "n분째 / n시간째" — 지금 상태의 경과 시간 표시. */
export function fmtElapsed(sinceISO: string, now: number): string {
  const min = Math.floor((now - Date.parse(sinceISO)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return '방금 시작';
  if (min < 60) return `${min}분째`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간째` : `${h}시간 ${m}분째`;
}

export interface CopySet {
  greeting: string; // 좁은 화면 홈의 인사 줄
  cta: string;
  diaryPh: string;
  todoPh: string;
  submit: string;
  editSubmit: string;
  empty: string;
  emptyMe: string;
  offNote: string;
  delAsk: string; // 기록 삭제 확인 물음
  delNote: string; // 되돌릴 수 없다는 안내
  footer: string;
  count: (n: number) => string;
  calEmpty: string;
  statusAsk: string; // 체크인 꺼짐 안내
  statusOn: string; // 체크인 켜짐 머리
  statusEnd: string; // 끄기 버튼
  placeAt: (place: string) => string; // "{장소}에서" — 체크인 카드와 크루 행이 함께 쓴다
  statusStarted: (place: string) => string; // 체크인 시작 토스트
  statusEnded: string; // 체크인 종료 토스트
}

export const COPY: CopySet = {
  greeting: '오늘도 조용히 성장 중',
  cta: '기록 남기기',
  diaryPh: '오늘 하루 기록하기', todoPh: '할 일 내용',
  submit: '기록 남기기', editSubmit: '수정 저장',
  empty: '아직 안 옴', emptyMe: '오늘 첫 기록을 남겨보세요',
  offNote: '쉬는 날은 별점 없이 기록돼요.',
  delAsk: '이 기록을 지울까요?', delNote: '지운 기록은 되돌릴 수 없어요.',
  footer: '오늘도 크루 중 누군가는 공부를 합니다.',
  count: (n) => `${MEMBERS.length}명 중 ${n}명 도장 찍음`,
  calEmpty: '이 날은 다들 조용했네요.',
  statusAsk: '공부 시작하면 켜주세요',
  statusOn: '공부 중',
  statusEnd: '공부 종료',
  placeAt: (p) => `${p}에서`,
  statusStarted: (p) => `${p}에서 공부 시작 — 크루에게 보였어요`,
  statusEnded: '공부를 종료했어요',
};

export const W = ['일', '월', '화', '수', '목', '금', '토'];
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function shiftKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/** 데모 모드 시드 — id가 UUID가 아니므로(s*) 저장·동기화되지 않고 메모리에만 산다. */
export function seedEntries(): Entry[] {
  const t = shiftKey(0), y = shiftKey(-1), b = shiftKey(-2);
  const now = new Date().toISOString();
  const base: Pick<Entry, 'body' | 'todos' | 'v' | 'updatedAt' | 'deletedAt'> = {
    body: '', todos: [], v: 0, updatedAt: now, deletedAt: null,
  };
  // tag·stars는 tags의 파생값이라 직접 쓰지 않고 여기서 한 번에 맞춘다. tags도 여기서
  // 정규화한다 — 리터럴이 TAGS 순서가 아니면 시드가 만든 tag와 화면이 entryTags로 다시
  // 계산한 대표 태그가 갈라져서, 같은 기록인데 삭제 확인창과 카드의 칩이 달라진다.
  const seed = (e: Omit<Entry, 'tag'>): Entry => {
    const tags = normalizeTags(e.tags);
    return { ...e, tags, tag: primaryTag(tags), stars: isOffTags(tags) ? null : e.stars };
  };
  return [
    seed({ ...base, id: 's1', m: 'wg', day: t, time: '09:40', tags: ['코딩테스트'], stars: 4, memo: '오전 스퍼트 완료',
      todos: [{ t: '그리디 3문제', done: true }, { t: 'DP 복습 1문제', done: true }, { t: '오답노트 정리', done: false }] }),
    seed({ ...base, id: 's2', m: 'jj', day: t, time: '13:12', tags: ['영어', '기타'], stars: 3, memo: '쉐도잉 20분',
      body: '혀가 먼저 퇴근했다.\n내일은 발음 교정 영상 보고 재도전. 그래도 오늘 표현 3개는 건짐 — at stake, for good, hold up.' }),
    seed({ ...base, id: 's10', m: 'kj', day: t, time: '07:50', tags: ['자격증', '영어'], stars: 4, memo: '남들 자는 시간에 몰래 30분',
      todos: [{ t: 'LC 1세트', done: true }, { t: '단어장 Day 12', done: true }, { t: '오답 다시 듣기', done: false }] }),
    seed({ ...base, id: 's3', m: 'sh', day: y, time: '22:05', tags: ['자격증'], stars: 5, memo: '기출 1회분 클리어. 오늘만큼은 천재' }),
    seed({ ...base, id: 's4', m: 'jj', day: y, time: '21:47', tags: ['자격증', '코딩테스트'], stars: 4, memo: 'DFS가 드디어 손에 붙음' }),
    seed({ ...base, id: 's5', m: 'wg', day: y, time: '20:11', tags: ['영어'], stars: 2, memo: '단어 데이',
      todos: [{ t: '단어 30개 암기', done: true }, { t: '복습 테스트', done: false }] }),
    seed({ ...base, id: 's11', m: 'kj', day: y, time: '19:05', tags: ['코딩테스트'], stars: 3, memo: '이분탐색이 나를 이분했다',
      body: '경계 조건 하나 틀려서 40분을 헌납했다. mid 계산은 이제 손이 먼저 기억하기로 약속함.' }),
    seed({ ...base, id: 's6', m: 'th', day: y, time: '11:30', tags: ['OFF'], stars: null, memo: '재충전의 날. 침대와 물아일체' }),
    seed({ ...base, id: 's7', m: 'sh', day: b, time: '23:59', tags: ['코딩테스트'], stars: 2, memo: 'DP는 대체 누가 만들었을까' }),
    seed({ ...base, id: 's8', m: 'th', day: b, time: '19:02', tags: ['자격증', '영어', '기타'], stars: 4, memo: '자막 없이 미드 완주',
      body: '한 편을 자막 없이 봤다. 절반은 뉘앙스로 때려 맞혔지만, 그것도 실력이라고 우기기로 함.' }),
    seed({ ...base, id: 's9', m: 'jj', day: b, time: '15:20', tags: ['자격증'], stars: 3, memo: '요약노트 정리. 손목이 아파요' }),
  ];
}

/** 시드 댓글 시각 — 기록의 날짜(로컬)와 HH:MM을 합쳐 ISO로. 오프셋 없는 문자열은
    로컬 시각으로 파싱되므로 카드에 찍히는 시각이 기록의 시각과 같은 기준이 된다. */
const seedAt = (day: string, hhmm: string): string => new Date(`${day}T${hhmm}:00`).toISOString();

/** 데모 모드 댓글 시드 — id가 UUID가 아니고(c*) 시드 기록(s*)에 달려 있어
    지속·동기화되지 않는다. 메모리에서는 그대로 조작할 수 있다. */
export function seedComments(): Comment[] {
  const t = shiftKey(0), y = shiftKey(-1);
  const c = (id: string, entryId: string, m: MemberId, day: string, hhmm: string, body: string): Comment => {
    const at = seedAt(day, hhmm);
    return { id, entryId, m, body, createdAt: at, updatedAt: at, deletedAt: null };
  };
  return [
    c('c1', 's2', 'sh', t, '13:40', '쉐도잉은 3일차부터 갑자기 들려요. 그때까지만 버티기'),
    c('c2', 's2', 'wg', t, '14:02', 'at stake 오늘 문제집에서도 나왔는데'),
    c('c3', 's1', 'th', t, '10:12', '오답노트까지 하면 오늘은 그냥 완벽인데'),
    c('c4', 's3', 'jj', y, '22:31', '천재 인정. 저는 아직 3회분 남았어요'),
    c('c5', 's3', 'th', y, '22:48', '기출 회차 뭐 푸는지 알려주세요'),
    c('c6', 's6', 'wg', y, '12:04', '쉬는 것도 일정입니다'),
    c('c7', 's10', 'sh', t, '09:05', '7시 50분이라니. 저는 그 시간에 알람과 싸우는 중'),
    c('c8', 's2', 'kj', t, '15:20', '쉐도잉 3일차에서 도망친 사람이 여기 있습니다'),
    c('c9', 's5', 'kj', y, '20:40', '복습 테스트가 진짜 본체인데'),
  ];
}

/** 데모 모드 리액션 시드 — 기록×멤버당 1행. 시드 기록에 달려 메모리 전용이다. */
export function seedReactionSets(): ReactionSet[] {
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const r = (entryId: string, m: MemberId, emojis: ReactionSet['emojis'], min: number): ReactionSet => ({
    entryId, m, emojis, actedAt: ago(min), updatedAt: ago(min),
  });
  return [
    r('s2', 'sh', ['👏'], 180), r('s2', 'wg', ['👏'], 165), r('s2', 'th', ['🔥'], 150),
    r('s2', 'kj', ['👏', '🔥'], 140),
    r('s1', 'jj', ['👏'], 300), r('s1', 'kj', ['💪'], 290),
    r('s10', 'wg', ['💪'], 250), r('s10', 'jj', ['👏'], 240), r('s10', 'th', ['👀'], 230),
    r('s3', 'wg', ['👏', '💪'], 700), r('s3', 'th', ['👏'], 690), r('s3', 'jj', ['👏'], 680),
    r('s6', 'sh', ['😴'], 800), r('s6', 'wg', ['😴'], 790),
  ];
}

/** 데모 모드 알림 시드 — 디자인의 내역 화면 예시를 시드 기록(s*)에 맞게 옮겼다.
    id가 UUID가 아니라(n*) 지속·동기화되지 않는다. 보는 사람(me) 기준으로 행위자를 고른다. */
export function seedNotifications(me: MemberId): Notification[] {
  const now = Date.now();
  const ago = (min: number): string => new Date(now - min * 60_000).toISOString();
  // 본인을 뺀 크루에서 순환해 고른다 — 멤버 수가 몇이든(1명이어도) 시드가 깨지지 않는다.
  const others = MEMBER_IDS.filter((m) => m !== me);
  const who = (i: number): MemberId => others[i % others.length] ?? me;
  const [a, b, c, d] = [who(0), who(1), who(2), who(3)];
  const n = (
    id: string,
    min: number,
    p: Partial<Notification> & Pick<Notification, 'kind' | 'why'>,
  ): Notification => ({
    id,
    m: me,
    actor: null,
    entryId: null,
    quote: '',
    ctx: '',
    actors: [],
    count: 1,
    createdAt: ago(min),
    updatedAt: ago(min),
    readAt: null,
    ...p,
  });
  return [
    n('n1', 46, { kind: 'mention', why: 'mention', actor: c,
      quote: `@${MEMBER_NAMES[me]} 그 문제집 몇 회독 했어요? 나도 사려는데`,
      ctx: `${MEMBER_NAMES[c]}의 기록 · 자격증` }),
    n('n2', 118, { kind: 'comment', why: 'mine', actor: a,
      quote: '하루에 코테 3문제라니 미쳤다', ctx: '내 기록 · 코딩테스트' }),
    n('n3', 260, { kind: 'start', why: 'daily', actor: a, ctx: '도서관 · 오전 9:12' }),
    n('n4', 60 * 21, { kind: 'react', why: 'react_daily', count: 5, actors: [a, b, c],
      updatedAt: ago(60 * 20), readAt: ago(60 * 2) }),
    n('n5', 60 * 27, { kind: 'reply', why: 'reply', actor: b,
      quote: '그 강의 2배속으로 들으면 딱 맞아요',
      ctx: `${MEMBER_NAMES[b]}의 기록 · 영어`, readAt: ago(60 * 3) }),
    n('n6', 60 * 29, { kind: 'system', why: 'quiet', count: 2,
      ctx: `오전 1:10 ${MEMBER_NAMES[b]} 시작 · 오전 2:40 ${MEMBER_NAMES[c]} 댓글`,
      readAt: ago(60 * 3) }),
    n('n7', 60 * 31, { kind: 'start', why: 'daily', actor: c, ctx: '카페 · 오후 1:45', readAt: ago(60 * 4) }),
    n('n8', 60 * 34, { kind: 'comment', why: 'mine', actor: d,
      quote: '이 페이스면 다음 주엔 저를 앞지르겠는데요',
      ctx: '내 기록 · 영어', readAt: ago(60 * 5) }),
  ];
}

/** 데모 모드 상태 시드 — 메모리에만 살고 지속·동기화되지 않는다. */
export function seedStatuses(): MemberStatus[] {
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    { m: 'wg', on: true, place: '도서관', since: ago(95), updatedAt: ago(95) },
    { m: 'jj', on: true, place: '카페', since: ago(20), updatedAt: ago(20) },
    { m: 'kj', on: true, place: '집', since: ago(48), updatedAt: ago(48) },
  ];
}
