import { describe, expect, it } from 'vitest';
import { MEMBER_IDS, type MemberId } from '../../shared/types';
import { advanceRoomLife, arriveRoomAgent, createRoomLife, returnRoomLifeHome, roomAgentBubble, syncRoomLife, type RoomActivities, type RoomLife } from './pixelLife';
import { ROOM_SPOTS, roomDestination, roomMotion, roomRoute, type RoomAction, type RoomPoint } from './pixelRoom';

const mixed: RoomActivities = { sh: 'rest', wg: 'library', th: 'rest', jj: 'rest', kj: 'library' };
const all = (activity: RoomActivities['sh']): RoomActivities => Object.fromEntries(MEMBER_IDS.map((id) => [id, activity])) as RoomActivities;

function expectAllowedDestinations(life: RoomLife) {
  for (const agent of Object.values(life.agents)) {
    if (agent.spot === 'home') {
      expect(agent.target).toEqual(roomDestination(MEMBER_IDS.indexOf(agent.id), MEMBER_IDS.length, agent.home));
    } else {
      expect(agent.home).not.toBe('away');
      expect(ROOM_SPOTS[agent.spot].zone === '도서관').toBe(agent.home === 'library');
    }
  }
  for (const id of life.conversation?.members ?? []) expect(life.agents[id].home).toBe('rest');
}

// The scheduler receives arrivals after real route durations, rather than treating travel as instantaneous.
function simulate(initial: RoomLife, duration: number, observe: (state: RoomLife) => void = () => {}) {
  let life = initial;
  const positions = Object.fromEntries(MEMBER_IDS.map((id) => [id, life.agents[id].target])) as Record<MemberId, RoomPoint>;
  const flights = new Map<MemberId, { version: number; at: number }>();
  for (let elapsed = 0; elapsed < duration; elapsed += 500) {
    life = advanceRoomLife(life, 500);
    for (const id of MEMBER_IDS) {
      const agent = life.agents[id];
      if (agent.phase !== 'walking') continue;
      let flight = flights.get(id);
      if (!flight || flight.version !== agent.version) {
        flight = { version: agent.version, at: life.clock + roomMotion(roomRoute(positions[id], agent.target)).duration };
        flights.set(id, flight);
      }
      if (flight.at <= life.clock) {
        positions[id] = agent.target;
        life = arriveRoomAgent(life, id, agent.version);
      }
    }
    observe(life);
  }
  return life;
}

function startChat(): RoomLife {
  let state = createRoomLife(all('rest'));
  for (let i = 0; i < 8; i++) state = advanceRoomLife(state, 500);
  expect(state.conversation).not.toBeNull();
  return state;
}

describe('autonomous campus life', () => {
  it('visits every kind of activity on its own while preserving real study status', () => {
    const actions = new Set<RoomAction>();
    const visits = new Set<string>();
    const state = simulate(createRoomLife(mixed), 240_000, (life) => {
      expectAllowedDestinations(life);
      for (const id of MEMBER_IDS) {
        const agent = life.agents[id];
        expect(agent.home).toBe(mixed[id]);
        if (agent.phase === 'acting') { actions.add(agent.action); visits.add(agent.spot); }
      }
    });
    expect(actions).toEqual(new Set(['study', 'rest', 'water', 'wander', 'read', 'browse', 'coffee', 'chat']));
    expect(visits.has('coffee')).toBe(true);
    expect(visits.has('tea_left') || visits.has('tea_right')).toBe(true);
    expect(visits.has('flowers')).toBe(true);
    expect(state.chatCount).toBeGreaterThan(2);
    expect(state.events.length).toBeLessThanOrEqual(4);
  });

  it('reserves different destinations including people still walking there', () => {
    simulate(createRoomLife(all('rest')), 180_000, (life) => {
      expectAllowedDestinations(life);
      const agents = Object.values(life.agents);
      for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
        expect(Math.hypot(agents[i]!.target.x - agents[j]!.target.x, agents[i]!.target.y - agents[j]!.target.y)).toBeGreaterThanOrEqual(28);
      }
    });
  });

  it('keeps all five studying members inside and returns them to their own desk between shelf visits', () => {
    const homes = new Set<MemberId>();
    const outings = new Set<MemberId>();
    simulate(createRoomLife(all('library')), 120_000, (life) => {
      expectAllowedDestinations(life);
      expect(life.conversation).toBeNull();
      for (const id of MEMBER_IDS) {
        const agent = life.agents[id];
        expect(agent.home).toBe('library');
        if (agent.spot !== 'home') outings.add(id);
        if (agent.phase === 'acting' && agent.spot === 'home' && agent.version > 0) {
          homes.add(id);
          expect(agent.action).toBe('study');
          expect(agent.target).toEqual(roomDestination(MEMBER_IDS.indexOf(id), 5, 'library'));
        }
      }
    });
    expect(outings.size).toBe(5);
    expect(homes.size).toBe(5);
  });

  it.each(MEMBER_IDS)('keeps a lone resting %s outside without inviting studying members to chat', (id) => {
    const visits = new Set<string>();
    simulate(createRoomLife({ ...all('library'), [id]: 'rest' }), 120_000, (life) => {
      expectAllowedDestinations(life);
      expect(life.conversation).toBeNull();
      if (life.agents[id].spot !== 'home') visits.add(life.agents[id].spot);
    });
    expect(visits.size).toBeGreaterThan(1);
  });

  it('ending study interrupts a shelf trip, leaves the library and rejects its stale arrival', () => {
    let before = createRoomLife(all('library'));
    for (let i = 0; i < 28; i++) before = advanceRoomLife(before, 500);
    expect(before.agents.sh.action).toBe('browse');
    expect(before.agents.sh.phase).toBe('walking');
    const after = syncRoomLife(before, { ...all('library'), sh: 'rest' });
    expect(after.agents.sh.home).toBe('rest');
    expect(after.agents.sh.spot).toBe('home');
    expect(after.agents.sh.target).toEqual(roomDestination(0, 5, 'rest'));
    expect(arriveRoomAgent(after, 'sh', before.agents.sh.version)).toBe(after);
    simulate(arriveRoomAgent(after, 'sh', after.agents.sh.version), 90_000, expectAllowedDestinations);
  });

  it('starts dialogue only after both members arrive, alternates speakers, and ends the conversation', () => {
    let state = startChat();
    const [a, b] = state.conversation!.members;
    state = arriveRoomAgent(state, a, state.agents[a].version);
    expect(state.conversation!.startedAt).toBeNull();
    expect(roomAgentBubble(state, a)).toBeNull();
    for (let i = 0; i < 20; i++) state = advanceRoomLife(state, 500);
    expect(state.agents[a].action).toBe('chat');
    expect(roomAgentBubble(state, a)).toBeNull();
    state = arriveRoomAgent(state, b, state.agents[b].version);
    expect(state.conversation!.startedAt).toBe(state.clock);
    expect(state.agents[a].facing).toBe('east');
    expect(state.agents[b].facing).toBe('west');
    const lines: string[] = [];
    for (let line = 0; line < 4; line++) {
      const speaker = line % 2 ? b : a;
      lines.push(roomAgentBubble(state, speaker)!);
      expect(roomAgentBubble(state, line % 2 ? a : b)).toBeNull();
      for (let i = 0; i < 6; i++) state = advanceRoomLife(state, 500);
    }
    expect(lines.every(Boolean)).toBe(true);
    expect(new Set(lines).size).toBe(4);
    expect(state.conversation).toBeNull();
    expect(state.agents[a].spot).toBe('home');
    expect(state.agents[b].spot).toBe('home');
  });

  it.each(['library', 'away'] as const)('a real %s check-in cancels a pair and rejects obsolete arrival callbacks', (activity) => {
    const before = startChat();
    const [a, b] = before.conversation!.members;
    const oldVersion = before.agents[a].version;
    const state = syncRoomLife(before, { ...all('rest'), [a]: activity });
    expect(state.conversation).toBeNull();
    expect(state.agents[a].home).toBe(activity);
    expect(state.agents[a].spot).toBe('home');
    expect(state.agents[b].spot).toBe('home');
    expectAllowedDestinations(state);
    expect(arriveRoomAgent(state, a, oldVersion)).toBe(state);
    expect(arriveRoomAgent(state, b, before.agents[b].version)).toBe(state);
    expect(before.conversation).not.toBeNull();
  });

  it('turning autonomy off sends everyone home and clears paired conversation', () => {
    const before = startChat();
    const state = returnRoomLifeHome(before);
    expect(state.conversation).toBeNull();
    expect(MEMBER_IDS.every((id) => state.agents[id].spot === 'home')).toBe(true);
    expect(returnRoomLifeHome(state)).toBe(state);
  });

  it('does not replay unchanged check-ins, advance a paused clock, or catch up a hidden interval', () => {
    const state = createRoomLife(mixed);
    expect(syncRoomLife(state, { ...mixed })).toBe(state);
    expect(advanceRoomLife(state, 0)).toBe(state);
    expect(advanceRoomLife(state, 3_600_000).clock).toBe(1000);
    expect(advanceRoomLife(state, 500).clock).toBe(500);
  });

  it('never brings people studying elsewhere back into the simulated campus', () => {
    const state = simulate(createRoomLife(all('away')), 90_000);
    expect(state.conversation).toBeNull();
    expect(state.events).toEqual([]);
    for (const id of MEMBER_IDS) {
      expect(state.agents[id].version).toBe(0);
      expect(roomAgentBubble(state, id)).toBeNull();
    }
  });

  it('does not mutate prior scheduler snapshots when conversations finish', () => {
    let state = startChat();
    for (const id of state.conversation!.members) state = arriveRoomAgent(state, id, state.agents[id].version);
    for (let i = 0; i < 23; i++) state = advanceRoomLife(state, 500);
    const before = structuredClone(state);
    for (const id of MEMBER_IDS) Object.freeze(state.agents[id]);
    Object.freeze(state.agents); Object.freeze(state);
    const next = advanceRoomLife(state, 500);
    expect(next.conversation).toBeNull();
    expect(state).toEqual(before);
  });
});
