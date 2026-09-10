import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { MemberId, MemberStatus } from '../../shared/types';
import { BY_ID, MEMBERS, fmtElapsed, type Member } from '../lib/constants';
import {
  ROOM_HEIGHT, ROOM_WIDTH, ROOM_PERSONALITY, roomActivity, roomDestination, roomFacing, roomMotion, roomRoute, roomStatusLabel,
  type RoomActivity, type RoomFacing, type RoomMood,
} from '../lib/pixelRoom';
import { PixelCharacter, PixelPortrait } from './PixelCharacter';
import { PixelDesk, PixelFrontWall, PixelRoomBackdrop, PixelRoomForeground } from './PixelRoomArt';
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

function RoomMember({ m, index, activity, motion, me, selected, label, onSelect, onDepth }: {
  m: Member; index: number; activity: RoomActivity; motion: boolean; me: boolean; selected: boolean;
  label: string; onSelect: (id: MemberId) => void; onDepth: (id: MemberId, y: number) => void;
}) {
  const actor = useRef<SVGGElement>(null);
  // On mount, show the known state immediately. Opening a tab is not a new check-in.
  const [initial] = useState(() => roomDestination(index, MEMBERS.length, activity));
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<RoomFacing>('south');
  const [arrived, setArrived] = useState(false);

  useLayoutEffect(() => {
    const element = actor.current;
    if (!element) return;
    const target = roomDestination(index, MEMBERS.length, activity);
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const from = { x: matrix.e, y: matrix.f };
    const route = roomRoute(from, target);
    const { frames, duration } = roomMotion(route);
    const timers: number[] = [];
    element.style.transform = `translate(${target.x}px, ${target.y}px)`;
    setArrived(false);
    if (!motion || duration < 1 || typeof element.animate !== 'function') {
      setWalking(false);
      setFacing('south');
      onDepth(m.id, target.y);
      return;
    }
    setWalking(true);
    const faceSegment = (i: number) => {
      setFacing(roomFacing(route[i]!, route[i + 1]!));
      onDepth(m.id, Math.max(route[i]!.y, route[i + 1]!.y));
    };
    faceSegment(0);
    frames.slice(1, -1).forEach((frame, i) => {
      timers.push(window.setTimeout(() => faceSegment(i + 1), frame.offset * duration));
    });
    const animation = element.animate(frames, { duration, easing: 'linear' });
    animation.onfinish = () => {
      setWalking(false);
      setFacing('south');
      setArrived(true);
      onDepth(m.id, target.y);
      timers.push(window.setTimeout(() => setArrived(false), 700));
    };
    return () => {
      // Capture the visible position before cancellation. Rapid toggles redirect from here,
      // and an obsolete animation can never complete a newer walk.
      const current = getComputedStyle(element).transform;
      animation.onfinish = null;
      timers.forEach(window.clearTimeout);
      element.style.transform = current;
      animation.cancel();
    };
  }, [activity, index, motion, m.id, onDepth]);

  const pose = walking ? 'walk' : activity === 'library' ? 'study' : 'idle';
  return (
    <g ref={actor} className="px-actor" data-member={m.id} data-activity={activity}
      data-moving={walking ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'} data-arrived={arrived ? 'true' : 'false'}
      role="button" tabIndex={activity === 'away' && !walking ? -1 : 0}
      aria-hidden={activity === 'away' && !walking ? true : undefined}
      aria-label={`${m.name} · ${label} · 자세히 보기`} aria-pressed={selected}
      onClick={() => onSelect(m.id)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(m.id); }
      }}
      style={{ transform: `translate(${initial.x}px, ${initial.y}px)`, '--px-delay': `${index * -0.73}s` } as CSSProperties}>
      <g opacity={activity === 'away' && !walking ? 0 : 1}>
        <rect className="px-hit-area" x={-22} y={-50} width={44} height={58} fill="transparent" />
        <ellipse className="px-actor-shadow" cy={1} rx={12} ry={4} fill="#253b36" opacity=".23" />
        <path className="px-selection-ring" d="M-15-2h30v7h-30z" fill="none" stroke="#fbe2a0" strokeWidth="1.5" />
        {walking && <path className="px-footsteps" d="M-8 3h3v2h-3zM5 6h3v2H5z" fill="#e2d1a9" opacity=".6" />}
        <g transform="translate(-14.4 -38.4) scale(1.2)"><PixelCharacter m={m} pose={pose} facing={facing} /></g>
        <g className="px-nameplate" transform="translate(0 -51)">
          <rect x={-19} y={-1} width={38} height={13} rx={3} fill={selected || me ? '#fae3a3' : '#f7efd8'} fillOpacity=".95" />
          <text x={0} y={7.5} textAnchor="middle" className="px-name">{m.name}</text>
          {activity === 'library' && !walking && <path d="M13 3h3v3h-3z" fill="#738b58" />}
        </g>
        {arrived && <g className="px-arrival" fill="#ffe6a4"><path d="M-21-28h3v3h-3zM19-39h3v3h-3zM15-15h2v2h-2z" /></g>}
      </g>
    </g>
  );
}

const MOODS: { id: RoomMood; label: string; description: string }[] = [
  { id: 'sunset', label: '노을', description: '노을이 내려앉은 오후' },
  { id: 'night', label: '밤', description: '불빛 아래, 조용한 밤' },
  { id: 'rain', label: '비', description: '창밖에 비가 내리는 날' },
];

export function MoodIcon({ mood }: { mood: RoomMood }) {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    {mood === 'sunset' ? <><path d="M4 13a6 6 0 0 1 12 0M2 14h16M4 17h12M10 1v3M2 5l2 2M18 5l-2 2" /></>
      : mood === 'night' ? <path d="M16 12A7 7 0 0 1 8 3a7 7 0 1 0 8 9ZM15 3v3m-1.5-1.5h3" />
        : <><path d="M5 12a3 3 0 0 1-1-6 5 5 0 0 1 10-1 3.5 3.5 0 0 1 1 7H5Z" /><path d="m6 15-1 3m6-3-1 3m6-3-1 3" /></>}
  </svg>;
}

export function PixelStudyRoom({ statuses, now, meId, compact = false, selectedId, onSelectMember }: {
  statuses: Partial<Record<MemberId, MemberStatus>>;
  now: number;
  meId?: MemberId;
  compact?: boolean;
  selectedId?: MemberId;
  onSelectMember?: (id: MemberId) => void;
}) {
  const [paused, setPaused] = useState(false);
  const [mood, setMood] = useState<RoomMood>('sunset');
  const moodIndex = MOODS.findIndex((option) => option.id === mood);
  const nextMood = MOODS[(moodIndex + 1) % MOODS.length]!;
  const [localSelected, setLocalSelected] = useState<MemberId>(meId ?? 'wg');
  const selected = selectedId ?? localSelected;
  const selectMember = useCallback((id: MemberId) => { setLocalSelected(id); onSelectMember?.(id); }, [onSelectMember]);
  const [depths, setDepths] = useState<Partial<Record<MemberId, number>>>({});
  const onDepth = useCallback((id: MemberId, y: number) => {
    setDepths((old) => old[id] === y ? old : { ...old, [id]: y });
  }, []);
  const allowed = useSyncExternalStore(subscribeMotion, motionAllowed, () => false);
  const motion = allowed && !paused;
  const members = MEMBERS.map((m, index) => ({ m, index, activity: roomActivity(statuses[m.id], now) }));
  const studying = members.filter((m) => m.activity === 'library').length;
  const resting = members.filter((m) => m.activity === 'rest').length;
  const away = members.filter((m) => m.activity === 'away');
  const description = members.map(({ m }) => `${m.name}: ${roomStatusLabel(statuses[m.id], now)}`).join(', ');
  const selectedStatus = statuses[selected];
  const selectedActivity = roomActivity(selectedStatus, now);
  const personality = ROOM_PERSONALITY[selected];
  const details = selectedActivity === 'library' ? personality.studyLabel : selectedActivity === 'rest' ? personality.restLabel : roomStatusLabel(selectedStatus, now);
  const scenery = members.map(({ m, index, activity }) => {
    const seat = roomDestination(index, MEMBERS.length, 'library');
    return { key: `desk-${m.id}`, depth: seat.y + 30, node: <PixelDesk x={seat.x} y={seat.y} lit={activity === 'library'} kind={ROOM_PERSONALITY[m.id].study} color={m.color} /> };
  });
  const actors = members.map(({ m, index, activity }) => ({
    key: m.id, depth: depths[m.id] ?? roomDestination(index, MEMBERS.length, activity).y,
    node: <RoomMember m={m} index={index} activity={activity} motion={motion} me={m.id === meId}
      selected={selected === m.id} label={roomStatusLabel(statuses[m.id], now)} onSelect={selectMember} onDepth={onDepth} />,
  }));
  const layers = [...scenery, ...actors, { key: 'front-wall', depth: 290, node: <PixelFrontWall /> }].sort((a, b) => a.depth - b.depth);

  return (
    <section className={'pixel-room' + (compact ? ' pixel-room-compact' : '')} aria-label="크루 도서관" data-mood={mood}>
      <div className="pixel-room-head">
        <div className="pixel-room-heading"><div className="pixel-room-title"><span className="pixel-room-mark" aria-hidden="true">✦</span> 숲속 도서관</div>
          {!compact && <span className="pixel-room-subtitle">{MOODS.find((m) => m.id === mood)!.description}</span>}</div>
        {!compact && <div className="pixel-room-moods" role="group" aria-label="공간 분위기">
          {MOODS.map((option) => <button key={option.id} type="button" aria-pressed={mood === option.id}
            aria-label={`${option.label} 분위기`} onClick={() => setMood(option.id)}><MoodIcon mood={option.id} />{option.label}</button>)}
        </div>}
        <span className="pixel-room-live"><span />{studying}명 공부 중</span>
      </div>
      <div className="pixel-room-stage" data-motion={motion ? 'on' : 'off'}>
        <svg viewBox={`0 0 ${ROOM_WIDTH} ${ROOM_HEIGHT}`} className="pixel-room-world"
          role="group" aria-label={description} shapeRendering="crispEdges">
          <g aria-hidden="true"><PixelRoomBackdrop /></g>
          {layers.map((layer) => <g key={layer.key}>{layer.node}</g>)}
          <g aria-hidden="true" pointerEvents="none"><PixelRoomForeground /></g>
        </svg>
      </div>
      <div className="pixel-room-insight" data-selected-member={selected}>
        <span className="pixel-room-insight-avatar" style={{ background: BY_ID[selected].soft }}><PixelPortrait m={BY_ID[selected]} /></span>
        <div className="pixel-room-insight-copy"><strong>{BY_ID[selected].name}<span>{selectedActivity === 'library' ? '도서관' : selectedActivity === 'rest' ? '정원' : selectedStatus?.place ?? '기타'}</span></strong><span>{details}</span></div>
        <span className="pixel-room-insight-time">{selectedActivity !== 'rest' && selectedStatus?.since ? fmtElapsed(selectedStatus.since, now) : '잠깐의 여유'}</span>
      </div>
      <div className="pixel-room-foot">
        <span className="pixel-room-rest"><span />휴식 {resting}명{away.length > 0 ? ` · 다른 장소 ${away.length}명` : ''}</span>
        <div className="pixel-room-tools">
        {compact && <button type="button" className="pixel-mood-cycle" onClick={() => setMood(nextMood.id)}
          aria-label={`현재 ${MOODS[moodIndex]!.label} · ${nextMood.label} 분위기로 바꾸기`}>
          <MoodIcon mood={mood} />{MOODS[moodIndex]!.label}
        </button>}
        <button type="button" className="pixel-motion-toggle" aria-pressed={paused}
          aria-label={paused ? '캐릭터 움직임 켜기' : '캐릭터 움직임 끄기'} onClick={() => setPaused((value) => !value)}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            {paused ? <path d="m5 3 7 5-7 5z" fill="currentColor" /> : <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />}
          </svg>
          {paused ? '움직임 켜기' : '움직임 끄기'}
        </button>
        </div>
      </div>
      {away.length > 0 && <p className="pixel-room-away">다른 곳에서도 함께해요 · {away.map(({ m }) => `${m.name}(${statuses[m.id]?.place ?? '기타'})`).join(', ')}</p>}
    </section>
  );
}
