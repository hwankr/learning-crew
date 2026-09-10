import { useCallback, useEffect, useLayoutEffect, useReducer } from 'react';
import type { MemberId } from '../../shared/types';
import { advanceRoomLife, arriveRoomAgent, createRoomLife, returnRoomLifeHome, syncRoomLife, type RoomActivities, type RoomLife } from '../lib/pixelLife';

type LifeAction = { type: 'sync'; activities: RoomActivities } | { type: 'tick'; elapsed: number }
  | { type: 'arrive'; id: MemberId; version: number } | { type: 'home' };
function reduceLife(state: RoomLife, action: LifeAction): RoomLife {
  switch (action.type) {
    case 'sync': return syncRoomLife(state, action.activities);
    case 'tick': return advanceRoomLife(state, action.elapsed);
    case 'arrive': return arriveRoomAgent(state, action.id, action.version);
    case 'home': return returnRoomLifeHome(state);
  }
}

export function useRoomLife(activities: RoomActivities, running: boolean, speed: number) {
  const [life, dispatch] = useReducer(reduceLife, activities, createRoomLife);
  const { sh, wg, th, jj, kj } = activities;
  useLayoutEffect(() => { dispatch({ type: 'sync', activities: { sh, wg, th, jj, kj } }); }, [sh, wg, th, jj, kj]);
  useEffect(() => {
    if (!running) return;
    // Fixed virtual steps prevent background throttling from skipping entire activities.
    const timer = window.setInterval(() => dispatch({ type: 'tick', elapsed: 500 * speed }), 500);
    return () => window.clearInterval(timer);
  }, [running, speed]);
  const arrive = useCallback((id: MemberId, version: number) => dispatch({ type: 'arrive', id, version }), []);
  const returnHome = useCallback(() => dispatch({ type: 'home' }), []);
  return { life, arrive, returnHome };
}
