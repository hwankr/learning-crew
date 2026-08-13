import { MEMBER_NAMES } from '../../shared/types';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
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
];

export const BY_ID: Record<MemberId, Member> = Object.fromEntries(MEMBERS.map((m) => [m.id, m])) as Record<
  MemberId,
  Member
>;

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
  greeting: string;
  cta: string;
  ctaNone: string;
  ctaSome: (n: number) => string;
  diaryPh: string;
  todoPh: string;
  submit: string;
  editSubmit: string;
  empty: string;
  emptyMe: string;
  offNote: string;
  footer: string;
  caps: string[];
  count: (n: number) => string;
  calEmpty: string;
  statusAsk: string; // 상태 off일 때 안내
  statusLive: (place: string) => string; // 내 상태 on 문구
  statusEnd: string; // 끄기 버튼
  statusPeer: (place: string) => string; // 보드에서 남의 상태 한 줄
}

export const COPY: Record<'subtle' | 'drip', CopySet> = {
  subtle: {
    greeting: '오늘도 조용히 성장 중',
    cta: '오늘 기록 남기기', ctaNone: '아직 오늘 기록이 없어요', ctaSome: (n) => `오늘 ${n}개 남겼어요. 하나 더?`,
    diaryPh: '오늘 있었던 일, 편하게 풀어놓아요.', todoPh: '할 일 내용',
    submit: '기록 남기기', editSubmit: '수정 저장',
    empty: '아직 안 옴', emptyMe: '오늘 첫 기록을 남겨보세요',
    offNote: '쉬는 날은 별점 없이 기록돼요.',
    footer: '오늘도 크루 중 누군가는 공부를 합니다.',
    caps: ['별점을 골라주세요', '…내일이 있으니까요', '시동은 걸었어요', '무난하게 순항 중', '오늘 좀 했는데요?', '이 구역의 공부왕'],
    count: (n) => `4명 중 ${n}명 도장 찍음`,
    calEmpty: '이 날은 다들 조용했네요.',
    statusAsk: '공부 시작하면 켜주세요 — 어디서 하나요?',
    statusLive: (p) => `${p}에서 공부 중`,
    statusEnd: '마침',
    statusPeer: (p) => `지금 ${p}에서 공부 중`,
  },
  drip: {
    greeting: '뇌 용량 증설 공사 중',
    cta: '오늘 기록 남기기', ctaNone: '오늘 아직 0개. 크루가 지켜봅니다', ctaSome: (n) => `오늘 ${n}개째. 멈추지 마세요`,
    diaryPh: '오늘의 서사, 마음껏 펼치세요.', todoPh: '뭘 하려고 했더라',
    submit: '박제하기', editSubmit: '변명 수정',
    empty: '잠수 중', emptyMe: '본인 도장부터 찍으시죠?',
    offNote: '공식 휴무. 죄책감은 반납하세요.',
    footer: '공부는 원래 남이 하는 게 제일 재밌습니다.',
    caps: ['별점을 골라주세요', '별점이 아깝다는 건 아니고', '한 듯 안 한 듯', '평타는 쳤다', '꽤 진지했잖아요?', '수석 각'],
    count: (n) => `4명 중 ${n}명 생존 신고`,
    calEmpty: '전원 잠수한 날이네요.',
    statusAsk: '어디서 하는지 자수하세요',
    statusLive: (p) => `${p} 감금 중`,
    statusEnd: '탈출',
    statusPeer: (p) => `지금 ${p} 감금 중`,
  },
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
  return [
    { ...base, id: 's1', m: 'wg', day: t, time: '09:40', tag: '코딩테스트', stars: 4, memo: '오전 스퍼트 완료',
      todos: [{ t: '그리디 3문제', done: true }, { t: 'DP 복습 1문제', done: true }, { t: '오답노트 정리', done: false }] },
    { ...base, id: 's2', m: 'jj', day: t, time: '13:12', tag: '영어', stars: 3, memo: '쉐도잉 20분',
      body: '혀가 먼저 퇴근했다.\n내일은 발음 교정 영상 보고 재도전. 그래도 오늘 표현 3개는 건짐 — at stake, for good, hold up.' },
    { ...base, id: 's3', m: 'sh', day: y, time: '22:05', tag: '자격증', stars: 5, memo: '기출 1회분 클리어. 오늘만큼은 천재' },
    { ...base, id: 's4', m: 'jj', day: y, time: '21:47', tag: '코딩테스트', stars: 4, memo: 'DFS가 드디어 손에 붙음' },
    { ...base, id: 's5', m: 'wg', day: y, time: '20:11', tag: '영어', stars: 2, memo: '단어 데이',
      todos: [{ t: '단어 30개 암기', done: true }, { t: '복습 테스트', done: false }] },
    { ...base, id: 's6', m: 'th', day: y, time: '11:30', tag: 'OFF', stars: null, memo: '재충전의 날. 침대와 물아일체' },
    { ...base, id: 's7', m: 'sh', day: b, time: '23:59', tag: '코딩테스트', stars: 2, memo: 'DP는 대체 누가 만들었을까' },
    { ...base, id: 's8', m: 'th', day: b, time: '19:02', tag: '영어', stars: 4, memo: '자막 없이 미드 완주',
      body: '한 편을 자막 없이 봤다. 절반은 뉘앙스로 때려 맞혔지만, 그것도 실력이라고 우기기로 함.' },
    { ...base, id: 's9', m: 'jj', day: b, time: '15:20', tag: '자격증', stars: 3, memo: '요약노트 정리. 손목이 아파요' },
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
    r('s1', 'jj', ['👏'], 300),
    r('s3', 'wg', ['👏', '💪'], 700), r('s3', 'th', ['👏'], 690), r('s3', 'jj', ['👏'], 680),
    r('s6', 'sh', ['😴'], 800), r('s6', 'wg', ['😴'], 790),
  ];
}

/** 데모 모드 상태 시드 — 메모리에만 살고 지속·동기화되지 않는다. */
export function seedStatuses(): MemberStatus[] {
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    { m: 'wg', on: true, place: '도서관', since: ago(95), updatedAt: ago(95) },
    { m: 'jj', on: true, place: '카페', since: ago(20), updatedAt: ago(20) },
  ];
}
