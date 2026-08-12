import type { Entry, MemberId, Tag } from '../../shared/types';

export interface Member {
  id: MemberId;
  name: string;
  color: string;
  soft: string;
  hairC: string;
  hair: string;
}

export const MEMBERS: Member[] = [
  { id: 'sh', name: '승환', color: '#FFB800', soft: '#FFF0BF', hairC: '#23262E',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-3.5-6-7-8.5-12.5-8.5s-9 2.5-12.5 8.5z' },
  { id: 'wg', name: '웅', color: '#12B76A', soft: '#C9F2DE', hairC: '#16181D',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0l-2.6-3.8-2.7 2.3-2.2-3.8-2.8 2.8-2.7-4.2-2.3 3.9-2.8-2.3-2 3.3z' },
  { id: 'th', name: '태현', color: '#2E90FA', soft: '#CFE5FE', hairC: '#4E555F',
    hair: 'M11.5 27a12.5 12.5 0 0 1 25 0c-1.3-4.2-3-6.8-5.7-7.9-3.8 2.2-9.2 2.1-12.6-.2-3.4 1.6-5.5 4.3-6.7 8.1z' },
  { id: 'jj', name: '진주', color: '#F79009', soft: '#FCE1BD', hairC: '#363B45',
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

export interface CopySet {
  greeting: string;
  cta: string;
  ctaNone: string;
  ctaSome: (n: number) => string;
  memoPh: string;
  modalHint: string;
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
}

export const COPY: Record<'subtle' | 'drip', CopySet> = {
  subtle: {
    greeting: '오늘도 조용히 성장 중',
    cta: '오늘 기록 남기기', ctaNone: '아직 오늘 기록이 없어요', ctaSome: (n) => `오늘 ${n}개 남겼어요. 하나 더?`,
    memoPh: '오늘 한 줄, 남겨볼까요?', modalHint: '한 줄이면 충분해요. 일기나 할 일 목록을 붙여도 좋고요.',
    diaryPh: '오늘 있었던 일, 편하게 풀어놓아요.', todoPh: '할 일 내용',
    submit: '기록 남기기', editSubmit: '수정 저장',
    empty: '아직 안 옴', emptyMe: '오늘 첫 기록을 남겨보세요',
    offNote: '쉬는 날은 별점 없이 기록돼요.',
    footer: '오늘도 크루 중 누군가는 공부를 합니다.',
    caps: ['별점을 골라주세요', '…내일이 있으니까요', '시동은 걸었어요', '무난하게 순항 중', '오늘 좀 했는데요?', '이 구역의 공부왕'],
    count: (n) => `4명 중 ${n}명 도장 찍음`,
    calEmpty: '이 날은 다들 조용했네요.',
  },
  drip: {
    greeting: '뇌 용량 증설 공사 중',
    cta: '오늘 기록 남기기', ctaNone: '오늘 아직 0개. 크루가 지켜봅니다', ctaSome: (n) => `오늘 ${n}개째. 멈추지 마세요`,
    memoPh: '변명이든 자랑이든 한 줄', modalHint: '어차피 크루는 다 알아봅니다. 솔직하게.',
    diaryPh: '오늘의 서사, 마음껏 펼치세요.', todoPh: '뭘 하려고 했더라',
    submit: '박제하기', editSubmit: '변명 수정',
    empty: '잠수 중', emptyMe: '본인 도장부터 찍으시죠?',
    offNote: '공식 휴무. 죄책감은 반납하세요.',
    footer: '공부는 원래 남이 하는 게 제일 재밌습니다.',
    caps: ['별점을 골라주세요', '별점이 아깝다는 건 아니고', '한 듯 안 한 듯', '평타는 쳤다', '꽤 진지했잖아요?', '수석 각'],
    count: (n) => `4명 중 ${n}명 생존 신고`,
    calEmpty: '전원 잠수한 날이네요.',
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
  const base: Pick<Entry, 'body' | 'todos' | 'updatedAt' | 'deletedAt'> = {
    body: '', todos: [], updatedAt: now, deletedAt: null,
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
