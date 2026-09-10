import { useCallback, useState, useSyncExternalStore } from 'react';
import type { MemberId, MemberStatus } from '../../shared/types';
import { BY_ID, MEMBERS, fmtElapsed } from '../lib/constants';
import {
  ROOM_HEIGHT, ROOM_WIDTH, ROOM_PERSONALITY, roomActivity, roomDestination, roomStatusLabel,
  type RoomMood,
} from '../lib/pixelRoom';
import { PixelPortrait } from './PixelCharacter';
import { PixelDesk, PixelDeskLight } from './PixelRoomArt';
import { PixelFrontWall, PixelRoomBackdrop, PixelRoomForeground } from './PixelCampusArt';
import { PixelMapViewport } from './PixelMapViewport';
import { PixelRoomMember } from './PixelRoomMember';
import { useRoomLife } from './useRoomLife';
import { roomAgentBubble, roomAgentLabel, type RoomActivities } from '../lib/pixelLife';
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
  const [autonomous, setAutonomous] = useState(true);
  const [speed, setSpeed] = useState(1);
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
  const activities = Object.fromEntries(members.map(({ m, activity }) => [m.id, activity])) as RoomActivities;
  const { life, arrive, returnHome } = useRoomLife(activities, motion && autonomous, speed);
  const studying = members.filter((m) => m.activity === 'library').length;
  const resting = members.filter((m) => m.activity === 'rest').length;
  const away = members.filter((m) => m.activity === 'away');
  const description = members.map(({ m }) => `${m.name}: ${roomStatusLabel(statuses[m.id], now)}`).join(', ');
  const selectedStatus = statuses[selected];
  const selectedActivity = roomActivity(selectedStatus, now);
  const details = selectedActivity === 'away' ? roomStatusLabel(selectedStatus, now) : roomAgentLabel(life.agents[selected]);
  const scenery = members.map(({ m, index }) => {
    const seat = roomDestination(index, MEMBERS.length, 'library');
    const agent = life.agents[m.id];
    const lit = agent.home === 'library' && agent.spot === 'home' && agent.phase === 'acting';
    return { key: `desk-${m.id}`, depth: seat.y + 30,
      light: <PixelDeskLight x={seat.x} y={seat.y} lit={lit} />,
      node: <PixelDesk x={seat.x} y={seat.y} lit={lit} kind={ROOM_PERSONALITY[m.id].study} color={m.color} /> };
  });
  const actors = members.map(({ m, index, activity }) => ({
    key: m.id, depth: depths[m.id] ?? roomDestination(index, MEMBERS.length, activity).y,
    node: <PixelRoomMember m={m} index={index} agent={life.agents[m.id]} motion={motion} speed={speed} me={m.id === meId}
      selected={selected === m.id} label={roomStatusLabel(statuses[m.id], now)} bubble={roomAgentBubble(life, m.id)}
      onSelect={selectMember} onDepth={onDepth} onArrive={arrive} />,
  }));
  const layers = [...scenery, ...actors, { key: 'front-wall', depth: 358, node: <PixelFrontWall /> }].sort((a, b) => a.depth - b.depth);

  return (
    <section className={'pixel-room' + (compact ? ' pixel-room-compact' : '')} aria-label="크루 도서관" data-mood={mood}
      data-autonomous={autonomous} data-life-clock={life.clock}>
      <div className="pixel-room-head">
        <div className="pixel-room-heading"><div className="pixel-room-title"><span className="pixel-room-mark" aria-hidden="true">✦</span> 숲속 캠퍼스</div>
          {!compact && <span className="pixel-room-subtitle">{MOODS.find((m) => m.id === mood)!.description}</span>}</div>
        {!compact && <div className="pixel-room-moods" role="group" aria-label="공간 분위기">
          {MOODS.map((option) => <button key={option.id} type="button" aria-pressed={mood === option.id}
            aria-label={`${option.label} 분위기`} onClick={() => setMood(option.id)}><MoodIcon mood={option.id} />{option.label}</button>)}
        </div>}
        <span className="pixel-room-live"><span />{studying}명 공부 중</span>
      </div>
      <PixelMapViewport selected={selected} compact={compact} motion={motion}>
        <svg viewBox={`0 0 ${ROOM_WIDTH} ${ROOM_HEIGHT}`} className="pixel-room-world"
          role="group" aria-label={description} shapeRendering="crispEdges">
          <g aria-hidden="true"><PixelRoomBackdrop /></g>
          <g aria-hidden="true" pointerEvents="none">{scenery.map((item) => <g key={item.key}>{item.light}</g>)}</g>
          {layers.map((layer) => <g key={layer.key}>{layer.node}</g>)}
          <g aria-hidden="true" pointerEvents="none"><PixelRoomForeground /></g>
        </svg>
      </PixelMapViewport>
      <div className="pixel-room-insight" data-selected-member={selected}>
        <span className="pixel-room-insight-avatar" style={{ background: BY_ID[selected].soft }}><PixelPortrait m={BY_ID[selected]} /></span>
        <div className="pixel-room-insight-copy"><strong>{BY_ID[selected].name}<span>{selectedActivity === 'library' ? '도서관' : selectedActivity === 'rest' ? '휴식 중' : selectedStatus?.place ?? '기타'}</span></strong><span>{details}</span></div>
        <span className="pixel-room-insight-time">{selectedActivity !== 'rest' && selectedStatus?.since ? fmtElapsed(selectedStatus.since, now) : '잠깐의 여유'}</span>
      </div>
      {!compact && <div className="pixel-room-story" aria-label="캐릭터 이야기 · 공간 속 연출">
        <span className="pixel-room-story-label"><span aria-hidden="true">✧</span> 캐릭터 이야기</span>
        <span className="pixel-room-story-text">{life.events[0]?.text ?? '크루가 저마다의 작은 하루를 시작해요.'}</span>
        <span className="pixel-room-fiction">공간 속 연출</span>
      </div>}
      <div className="pixel-room-foot">
        <span className="pixel-room-rest"><span />휴식 {resting}명{away.length > 0 ? ` · 다른 장소 ${away.length}명` : ''}</span>
        <div className="pixel-room-tools">
        <button type="button" className="pixel-life-toggle" aria-pressed={autonomous} aria-label="자율 행동"
          onClick={() => { if (autonomous) returnHome(); setAutonomous((value) => !value); }}>
          <span aria-hidden="true">{autonomous ? '✦' : '·'}</span>자율 행동 {autonomous ? '켜짐' : '꺼짐'}
        </button>
        {!compact && <button type="button" className="pixel-life-speed" aria-label={`캐릭터 속도 ${speed}배`} onClick={() => setSpeed((value) => value === 1 ? 2 : 1)}>{speed}×</button>}
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
      {compact && <p className="pixel-room-fiction-note">산책과 대화는 캐릭터의 작은 일상 연출이에요.</p>}
      {away.length > 0 && <p className="pixel-room-away">다른 곳에서도 함께해요 · {away.map(({ m }) => `${m.name}(${statuses[m.id]?.place ?? '기타'})`).join(', ')}</p>}
    </section>
  );
}
