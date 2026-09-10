import { MEMBER_IDS, MEMBER_NAMES, type MemberId } from '../../shared/types';
import { ROOM_PERSONALITY, ROOM_SPOTS, roomDestination, type RoomAction, type RoomActivity, type RoomFacing, type RoomPoint, type RoomSpotId } from './pixelRoom';

export type RoomActivities = Record<MemberId, RoomActivity>;
export interface RoomAgent {
  id: MemberId;
  home: RoomActivity;
  action: RoomAction;
  spot: RoomSpotId | 'home';
  target: RoomPoint;
  facing: RoomFacing;
  phase: 'walking' | 'acting';
  version: number;
  startedAt: number;
  due: number;
  cursor: number;
  conversations: number;
}
export interface RoomConversation { members: [MemberId, MemberId]; startedAt: number | null; topic: number }
export interface RoomLifeEvent { id: number; members: MemberId[]; text: string }
export interface RoomLife {
  clock: number;
  agents: Record<MemberId, RoomAgent>;
  conversation: RoomConversation | null;
  nextChatAt: number;
  chatCount: number;
  events: RoomLifeEvent[];
  eventId: number;
}

const REST_ROUTINES: Record<MemberId, RoomSpotId[]> = {
  sh: ['flowers', 'pond', 'coffee', 'reading', 'willow'],
  wg: ['coffee', 'reading', 'gate', 'pond', 'flowers'],
  th: ['reading', 'flowers', 'willow', 'pond', 'coffee'],
  jj: ['tea_right', 'willow', 'flowers', 'reading', 'gate'],
  kj: ['coffee', 'tea_left', 'reading', 'pond', 'flowers'],
};
const STUDY_ROUTINE: RoomSpotId[] = ['books_west', 'books_east'];
const DIALOGUES = [
  ['오늘 공부는 어때?', '조금씩 풀리고 있어!', '끝나고 커피 한 잔?', '좋아, 같이 힘내자.'],
  ['괜찮은 책 찾았어?', '응, 다음에 빌려줄게.', '고마워! 기대된다.', '천천히 읽어도 좋아.'],
  ['잠깐 바람 쐴까?', '여기 바람 참 좋다.', '쉬니까 다시 힘나네.', '우리 한 걸음씩 가자.'],
  ['오늘도 만나서 반가워.', '함께하니까 든든해!', '다음 페이지도 파이팅.', '응, 조금만 더 해보자.'],
] as const;
const CHAT_LINE_MS = 3000;
const CHAT_DURATION = CHAT_LINE_MS * 4;

function homeAgent(id: MemberId, home: RoomActivity, clock: number): RoomAgent {
  const index = MEMBER_IDS.indexOf(id);
  return { id, home, action: home === 'library' ? 'study' : 'rest', spot: 'home',
    target: roomDestination(index, MEMBER_IDS.length, home), facing: 'south', phase: 'acting', version: 0,
    startedAt: clock, due: clock + (home === 'library' ? 14_000 + index * 1200 : 2200 + index * 1300), cursor: 0, conversations: 0 };
}

export function createRoomLife(activities: RoomActivities): RoomLife {
  return { clock: 0, agents: Object.fromEntries(MEMBER_IDS.map((id) => [id, homeAgent(id, activities[id], 0)])) as Record<MemberId, RoomAgent>,
    conversation: null, nextChatAt: 4000, chatCount: 0, events: [], eventId: 0 };
}

function addEvent(state: RoomLife, members: MemberId[], text: string): RoomLife {
  const id = state.eventId + 1;
  return { ...state, eventId: id, events: [{ id, members, text }, ...state.events].slice(0, 4) };
}

function travel(agent: RoomAgent, spot: RoomSpotId | 'home', clock: number): RoomAgent {
  const point = spot === 'home' ? roomDestination(MEMBER_IDS.indexOf(agent.id), MEMBER_IDS.length, agent.home) : ROOM_SPOTS[spot];
  return { ...agent, spot, target: { x: point.x, y: point.y },
    action: spot === 'home' ? (agent.home === 'library' ? 'study' : 'rest') : ROOM_SPOTS[spot].action,
    facing: spot === 'home' ? 'south' : ROOM_SPOTS[spot].facing,
    phase: 'walking', version: agent.version + 1, startedAt: clock, due: Infinity };
}

/** Reservations include people already travelling there; home seats stay private. */
function available(state: RoomLife, spot: RoomSpotId, id: MemberId): boolean {
  const point = ROOM_SPOTS[spot];
  const home = state.agents[id].home;
  // Every autonomous destination, including paired chats and coffee follow-ups,
  // must stay on the same side of the library door as the real check-in.
  if (home === 'away' || (point.zone === '도서관') !== (home === 'library')) return false;
  return MEMBER_IDS.every((other) => other === id || state.agents[other].home === 'away'
    || Math.hypot(state.agents[other].target.x - point.x, state.agents[other].target.y - point.y) >= 28);
}

function cancelChat(state: RoomLife): RoomLife {
  if (!state.conversation) return state;
  const agents = { ...state.agents };
  for (const id of state.conversation.members) agents[id] = travel(agents[id], 'home', state.clock);
  return { ...state, agents, conversation: null, nextChatAt: state.clock + 12_000 };
}

/** A real check-in always supersedes a simulated activity, including paired conversations. */
export function syncRoomLife(state: RoomLife, activities: RoomActivities): RoomLife {
  const changed = MEMBER_IDS.filter((id) => state.agents[id].home !== activities[id]);
  if (!changed.length) return state;
  let next = state.conversation?.members.some((id) => changed.includes(id)) ? cancelChat(state) : state;
  const agents = { ...next.agents };
  for (const id of changed) agents[id] = travel({ ...agents[id], home: activities[id] }, 'home', next.clock);
  next = { ...next, agents };
  return next;
}

export function returnRoomLifeHome(state: RoomLife): RoomLife {
  const next = cancelChat(state);
  const agents = { ...next.agents };
  let changed = next !== state;
  for (const id of MEMBER_IDS) {
    if (agents[id].spot === 'home') continue;
    agents[id] = travel(agents[id], 'home', state.clock);
    changed = true;
  }
  return changed ? { ...next, agents } : state;
}

function dwell(agent: RoomAgent): number {
  if (agent.action === 'study') return 13_000 + MEMBER_IDS.indexOf(agent.id) * 1500;
  if (agent.action === 'rest') return 3200 + MEMBER_IDS.indexOf(agent.id) * 500;
  if (agent.action === 'browse') return 5500;
  if (agent.action === 'water') return 7500;
  if (agent.action === 'read') return 9000;
  if (agent.action === 'coffee') return agent.spot === 'coffee' ? 4500 : 6500;
  return 4200;
}

/** Completion comes from the actual animation; stale completions cannot finish a newer task. */
export function arriveRoomAgent(state: RoomLife, id: MemberId, version: number): RoomLife {
  const agent = state.agents[id];
  if (agent.version !== version || agent.phase !== 'walking') return state;
  let next: RoomLife = { ...state, agents: { ...state.agents, [id]: { ...agent, phase: 'acting', startedAt: state.clock, due: state.clock + dwell(agent) } } };
  if (agent.action === 'chat') {
    const conversation = next.conversation;
    if (conversation && conversation.startedAt === null && conversation.members.every((member) => next.agents[member].phase === 'acting')) {
      next = { ...next, conversation: { ...conversation, startedAt: next.clock } };
      next = addEvent(next, conversation.members, `${conversation.members.map((member) => MEMBER_NAMES[member]).join(', ')} · 정원에서 이야기를 나눠요.`);
    }
    return next;
  }
  if (agent.spot !== 'home') next = addEvent(next, [id], `${MEMBER_NAMES[id]} · ${ROOM_SPOTS[agent.spot].label}`);
  return next;
}

/** The simulation clock advances only while visible and enabled; it never catches up a hidden tab. */
export function advanceRoomLife(state: RoomLife, elapsed: number): RoomLife {
  if (elapsed <= 0) return state;
  let next: RoomLife = { ...state, clock: state.clock + Math.min(elapsed, 1000) };
  if (next.conversation && next.conversation.startedAt !== null && next.clock - next.conversation.startedAt >= CHAT_DURATION) {
    const members = next.conversation.members;
    next = cancelChat(next);
    next = { ...next, nextChatAt: next.clock + 22_000 };
    for (const id of members) next.agents[id] = { ...next.agents[id], conversations: next.agents[id].conversations + 1 };
  }
  if (!next.conversation && next.clock >= next.nextChatAt) {
    const candidates = MEMBER_IDS.filter((id) => {
      const agent = next.agents[id];
      return agent.home === 'rest' && agent.phase === 'acting' && agent.action !== 'water' && agent.action !== 'browse';
    }).sort((a, b) => next.agents[a].conversations - next.agents[b].conversations || MEMBER_IDS.indexOf(a) - MEMBER_IDS.indexOf(b));
    if (candidates.length >= 2 && available(next, 'chat_left', candidates[0]!) && available(next, 'chat_right', candidates[1]!)) {
      const members: [MemberId, MemberId] = [candidates[0]!, candidates[1]!];
      next = { ...next, agents: { ...next.agents,
        [members[0]]: travel(next.agents[members[0]], 'chat_left', next.clock),
        [members[1]]: travel(next.agents[members[1]], 'chat_right', next.clock) },
        conversation: { members, startedAt: null, topic: next.chatCount % DIALOGUES.length }, chatCount: next.chatCount + 1 };
    }
  }
  for (const id of MEMBER_IDS) {
    const agent = next.agents[id];
    if (agent.home === 'away' || agent.phase !== 'acting' || agent.action === 'chat' || agent.due > next.clock) continue;
    if (agent.spot === 'coffee') {
      const spot = (['tea_left', 'tea_right'] as const).find((candidate) => available(next, candidate, id));
      next = { ...next, agents: { ...next.agents, [id]: travel(agent, spot ?? 'home', next.clock) } };
      continue;
    }
    if (agent.spot !== 'home') {
      next = { ...next, agents: { ...next.agents, [id]: travel(agent, 'home', next.clock) } };
      continue;
    }
    const routine = agent.home === 'library' ? STUDY_ROUTINE : REST_ROUTINES[id];
    const choices = routine.map((_, i) => routine[(agent.cursor + i + (agent.home === 'library' ? MEMBER_IDS.indexOf(id) : 0)) % routine.length]!);
    const spot = choices.find((candidate) => available(next, candidate, id));
    if (spot) next = { ...next, agents: { ...next.agents, [id]: travel({ ...agent, cursor: agent.cursor + 1 }, spot, next.clock) } };
  }
  return next;
}

export function roomAgentLabel(agent: RoomAgent): string {
  if (agent.home === 'away') return '다른 장소에서 공부 중';
  if (agent.phase === 'walking') return agent.spot === 'home'
    ? (agent.home === 'library' ? '책상으로 돌아가는 중' : '쉬는 자리로 돌아가는 중')
    : `${ROOM_SPOTS[agent.spot].zone}으로 걸어가는 중`;
  return agent.spot === 'home' ? (agent.action === 'study' ? ROOM_PERSONALITY[agent.id].studyLabel : ROOM_PERSONALITY[agent.id].restLabel) : ROOM_SPOTS[agent.spot].label;
}

export function roomAgentBubble(state: RoomLife, id: MemberId): string | null {
  const agent = state.agents[id];
  if (agent.phase !== 'acting' || agent.home === 'away') return null;
  const conversation = state.conversation;
  if (agent.action === 'chat' && conversation && conversation.startedAt !== null) {
    const line = Math.floor((state.clock - conversation.startedAt) / CHAT_LINE_MS);
    return line < 4 && conversation.members[line % 2] === id ? DIALOGUES[conversation.topic]![line]! : null;
  }
  if (state.clock - agent.startedAt > 2800) return null;
  return { study: null, rest: null, browse: '이 책, 재밌겠다.', coffee: agent.spot === 'coffee' ? '좋은 향이다…' : '잠깐 충전!', read: '한 페이지 더!', water: '잘 자라렴.', wander: '바람이 좋네.', chat: null }[agent.action];
}
