import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { MemberId, MemberStatus } from '../../shared/types';
import { MEMBERS, type Member } from '../lib/constants';
import {
  ROOM_HEIGHT, ROOM_WIDTH, roomActivity, roomDestination, roomMotion, roomRoute, roomStatusLabel,
  type RoomActivity,
} from '../lib/pixelRoom';
import { PixelCharacter } from './PixelCharacter';
import { PixelDesk, PixelRoomBackdrop, PixelRoomForeground } from './PixelRoomArt';
import './pixel-study-room.css';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function subscribeMotion(cb: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener('change', cb);
  document.addEventListener('visibilitychange', cb);
  return () => {
    media.removeEventListener('change', cb);
    document.removeEventListener('visibilitychange', cb);
  };
}
function motionAllowed(): boolean {
  return !window.matchMedia(REDUCED_MOTION).matches && document.visibilityState !== 'hidden';
}

function RoomMember({ m, index, activity, motion, me }: {
  m: Member; index: number; activity: RoomActivity; motion: boolean; me: boolean;
}) {
  const actor = useRef<SVGGElement>(null);
  // On mount, show the known state immediately. Opening a tab is not a new check-in.
  const [initial] = useState(() => roomDestination(index, MEMBERS.length, activity));
  const [walking, setWalking] = useState(false);

  useLayoutEffect(() => {
    const element = actor.current;
    if (!element) return;
    const target = roomDestination(index, MEMBERS.length, activity);
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const from = { x: matrix.e, y: matrix.f };
    const { frames, duration } = roomMotion(roomRoute(from, target));
    element.style.transform = `translate(${target.x}px, ${target.y}px)`;
    if (!motion || duration < 1 || typeof element.animate !== 'function') {
      setWalking(false);
      return;
    }
    setWalking(true);
    const animation = element.animate(frames, { duration, easing: 'linear' });
    animation.onfinish = () => setWalking(false);
    return () => {
      // Capture the visible position before cancellation. Rapid toggles redirect from here,
      // and an obsolete animation can never complete a newer walk.
      const current = getComputedStyle(element).transform;
      animation.onfinish = null;
      element.style.transform = current;
      animation.cancel();
    };
  }, [activity, index, motion]);

  const pose = walking ? 'walk' : activity === 'library' ? 'study' : 'idle';
  return (
    <g ref={actor} className="px-actor" data-member={m.id} data-activity={activity}
      data-moving={walking ? 'true' : 'false'}
      style={{ transform: `translate(${initial.x}px, ${initial.y}px)`, '--px-delay': `${index * -0.73}s` } as CSSProperties}>
      <g opacity={activity === 'away' && !walking ? 0 : 1}>
        <path d="M-9-2H9v3H-9z" fill="#615b41" opacity=".17" />
        <g transform="translate(-12 -32)"><PixelCharacter m={m} pose={pose} /></g>
        <g className="px-nameplate" transform="translate(0 -43)">
          <rect x={-17} y={-1} width={34} height={12} rx={3} fill={me ? '#fae3a3' : '#fff9e9'} fillOpacity=".95" />
          <text x={0} y={7.5} textAnchor="middle" className="px-name">{m.name}</text>
          {activity === 'library' && !walking && <path d="M11 2h3v3h-3z" fill="#738b58" />}
        </g>
      </g>
    </g>
  );
}

export function PixelStudyRoom({ statuses, now, meId, compact = false }: {
  statuses: Partial<Record<MemberId, MemberStatus>>;
  now: number;
  meId?: MemberId;
  compact?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const allowed = useSyncExternalStore(subscribeMotion, motionAllowed, () => false);
  const motion = allowed && !paused;
  const members = MEMBERS.map((m, index) => ({ m, index, activity: roomActivity(statuses[m.id], now) }));
  const studying = members.filter((m) => m.activity === 'library').length;
  const resting = members.filter((m) => m.activity === 'rest').length;
  const away = members.filter((m) => m.activity === 'away');
  const description = members.map(({ m }) => `${m.name}: ${roomStatusLabel(statuses[m.id], now)}`).join(', ');

  return (
    <section className={'pixel-room' + (compact ? ' pixel-room-compact' : '')} aria-label="크루 도서관">
      <div className="pixel-room-head">
        <div className="pixel-room-title"><span className="pixel-room-mark" aria-hidden="true">✦</span> 크루 도서관</div>
        <span className="pixel-room-live"><span />{studying}명 공부 중</span>
      </div>
      <div className="pixel-room-stage" data-motion={motion ? 'on' : 'off'}>
        <svg viewBox={`0 0 ${ROOM_WIDTH} ${ROOM_HEIGHT}`} className="pixel-room-world"
          role="img" aria-label={description} shapeRendering="crispEdges">
          <PixelRoomBackdrop />
          {members.map(({ m, index }) => {
            const { x } = roomDestination(index, MEMBERS.length, 'library');
            return <path key={m.id} d={`M${x - 10} 155h20v19h-20z`} fill="#859174" />;
          })}
          {members.map(({ m, index, activity }) => (
            <RoomMember key={m.id} m={m} index={index} activity={activity} motion={motion} me={m.id === meId} />
          ))}
          {members.map(({ m, index, activity }) => (
            <PixelDesk key={m.id} x={roomDestination(index, MEMBERS.length, 'library').x} lit={activity === 'library'} />
          ))}
          <PixelRoomForeground />
        </svg>
      </div>
      <div className="pixel-room-foot">
        <span className="pixel-room-rest"><span />휴식 {resting}명{away.length > 0 ? ` · 다른 장소 ${away.length}명` : ''}</span>
        <button type="button" className="pixel-motion-toggle" aria-pressed={paused}
          aria-label={paused ? '캐릭터 움직임 켜기' : '캐릭터 움직임 끄기'} onClick={() => setPaused((value) => !value)}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            {paused ? <path d="m5 3 7 5-7 5z" fill="currentColor" /> : <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />}
          </svg>
          {paused ? '움직임 켜기' : '움직임 끄기'}
        </button>
      </div>
      {away.length > 0 && <p className="pixel-room-away">다른 곳에서도 함께해요 · {away.map(({ m }) => `${m.name}(${statuses[m.id]?.place ?? '기타'})`).join(', ')}</p>}
    </section>
  );
}
