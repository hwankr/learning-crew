import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { MemberId } from '../../shared/types';
import type { Member } from '../lib/constants';
import type { RoomAgent } from '../lib/pixelLife';
import { roomFacing, roomMotion, roomRoute, type RoomFacing } from '../lib/pixelRoom';
import { PixelCharacter } from './PixelCharacter';

export const PixelRoomMember = memo(function PixelRoomMember({ m, index, agent, motion, speed, me, selected, label, bubble, onSelect, onDepth, onArrive }: {
  m: Member; index: number; agent: RoomAgent; motion: boolean; speed: number; me: boolean; selected: boolean;
  label: string; bubble: string | null; onSelect: (id: MemberId) => void;
  onDepth: (id: MemberId, y: number) => void; onArrive: (id: MemberId, version: number) => void;
}) {
  const actor = useRef<SVGGElement>(null);
  const seenVersion = useRef(agent.version);
  const [initial] = useState(agent.target);
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<RoomFacing>(agent.facing);
  const [arrived, setArrived] = useState(false);
  const { target: { x, y }, version, facing: destinationFacing } = agent;

  useLayoutEffect(() => {
    const element = actor.current;
    if (!element) return;
    const changed = seenVersion.current !== version;
    seenVersion.current = version;
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const from = { x: matrix.e, y: matrix.f };
    const timers: number[] = [];
    setArrived(false);
    // Pausing freezes an in-flight walk. A new real check-in while paused still updates immediately.
    if (!motion && !changed) { setWalking(false); onDepth(m.id, from.y); return; }
    const route = roomRoute(from, { x, y });
    const travel = roomMotion(route);
    const duration = travel.duration / speed;
    element.style.transform = `translate(${x}px, ${y}px)`;
    const settle = () => {
      setWalking(false); setFacing(destinationFacing); onDepth(m.id, y); onArrive(m.id, version);
    };
    if (!motion || duration < 1 || typeof element.animate !== 'function') { settle(); return; }
    setWalking(true);
    const faceSegment = (i: number) => {
      setFacing(roomFacing(route[i]!, route[i + 1]!));
      onDepth(m.id, Math.max(route[i]!.y, route[i + 1]!.y));
    };
    faceSegment(0);
    travel.frames.slice(1, -1).forEach((frame, i) => timers.push(window.setTimeout(() => faceSegment(i + 1), frame.offset * duration)));
    const animation = element.animate(travel.frames, { duration, easing: 'linear' });
    animation.onfinish = () => {
      settle(); setArrived(true);
      timers.push(window.setTimeout(() => setArrived(false), 700));
    };
    return () => {
      // Redirect from the visible position and invalidate every callback owned by this walk.
      const current = getComputedStyle(element).transform;
      animation.onfinish = null;
      timers.forEach(window.clearTimeout);
      element.style.transform = current;
      animation.cancel();
    };
  }, [x, y, version, destinationFacing, motion, speed, m.id, onDepth, onArrive]);

  const acting = agent.phase === 'acting';
  const hidden = agent.home === 'away' && acting;
  const pose = walking ? 'walk' : acting && agent.action === 'study' ? 'study' : 'idle';
  const bubbleWidth = Math.max(66, (bubble?.length ?? 0) * 7 + 16);
  return <g ref={actor} className="px-actor" data-member={m.id} data-activity={agent.home} data-moving={walking ? 'true' : 'false'}
    data-action={agent.action} data-phase={agent.phase} data-spot={agent.spot} data-version={version}
    data-selected={selected ? 'true' : 'false'} data-arrived={arrived ? 'true' : 'false'}
    role="button" tabIndex={hidden ? -1 : 0} aria-hidden={hidden ? true : undefined}
    aria-label={`${m.name} · ${label} · 자세히 보기`} aria-pressed={selected}
    onClick={() => onSelect(m.id)} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(m.id); }
    }} style={{ transform: `translate(${initial.x}px, ${initial.y}px)`, '--px-delay': `${index * -.73}s` } as CSSProperties}>
    <g opacity={hidden ? 0 : 1}>
      <rect className="px-hit-area" x={-22} y={-50} width={44} height={58} fill="transparent" />
      <ellipse className="px-actor-shadow" cy={1} rx={12} ry={4} fill="#253b36" opacity=".23" />
      <ellipse className="px-selection-ring" cy={2} rx={16} ry={4.5} fill="none" stroke="#fbe2a0" strokeWidth="1" />
      {walking && <path className="px-footsteps" d="M-8 3h3v2h-3zM5 6h3v2H5z" fill="#e2d1a9" opacity=".6" />}
      <g transform="translate(-14.4 -38.4) scale(1.2)"><PixelCharacter m={m} pose={pose} facing={facing} action={acting ? agent.action : 'wander'} /></g>
      <g className="px-nameplate" transform="translate(0 -51)">
        <rect x={-19} y={-1} width={38} height={13} rx={2} fill={selected || me ? '#edd29b' : '#233b33'} fillOpacity=".94" stroke="#d5bd85" strokeOpacity=".45" strokeWidth=".5" />
        <text x={0} y={7.5} textAnchor="middle" className="px-name" fill={selected || me ? '#4c412b' : '#f0dfb9'}>{m.name}</text>
        {agent.home === 'library' && <path d="M13 3h3v3h-3z" fill="#738b58" />}
      </g>
      {arrived && <g className="px-arrival" fill="#ffe6a4"><path d="M-21-28h3v3h-3zM19-39h3v3h-3zM15-15h2v2h-2z" /></g>}
      {bubble && <g className="px-speech" data-kind={agent.action === 'chat' ? 'conversation' : 'thought'} pointerEvents="none" transform="translate(0 -77)">
        <path d={`M${-bubbleWidth / 2} 0h${bubbleWidth}v18H5l-5 5v-5h${-bubbleWidth / 2}z`} fill="#fff4d8" stroke="#6a7150" strokeWidth="1" />
        <text y={12} textAnchor="middle">{bubble}</text>
      </g>}
    </g>
  </g>;
});
