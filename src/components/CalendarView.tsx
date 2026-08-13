import type { Comment, Entry, MemberId, ReactionSet } from '../../shared/types';
import { entryTags, primaryTag } from '../../shared/types';
import { BY_ID, MEMBERS, TAGMETA, W, dayKey, pad2, shiftKey, type CopySet } from '../lib/constants';
import { Avatar, Icon } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 셀 하나에 보여줄 최대 알약 수 — 넘치면 "+N개 더". */
const MAX_PILLS = 3;

/** 오늘부터 거꾸로 센 연속 기록일. 오늘 아직 안 남긴 건 봐준다(어제까지 이어짐). */
function streakOf(m: MemberId, byDay: Map<string, Entry[]>): number {
  let streak = 0;
  for (let i = 0; i <= 366; i++) {
    const has = (byDay.get(shiftKey(-i)) ?? []).some((e) => e.m === m);
    if (has) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}

export function CalendarView({
  entries, calOff, setCalOff, selDay, setSelDay, todayKey, meId, editingId, comments, reactions,
  wit, actions,
}: {
  entries: Entry[];
  calOff: number;
  setCalOff: (n: number) => void;
  selDay: string;
  setSelDay: (k: string) => void;
  todayKey: string;
  meId: MemberId;
  editingId: string | null;
  comments: Map<string, Comment[]>;
  reactions: Map<string, ReactionSet[]>;
  wit: CopySet;
  actions: EntryActions;
}) {
  const now = new Date();
  const calBase = new Date(now.getFullYear(), now.getMonth() + calOff, 1);
  const daysIn = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 0).getDate();
  const lead = calBase.getDay();

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }

  // 멤버별 월 요약 — 연속일은 항상 오늘 기준이라 다른 달 요약에는 어울리지 않는다 (이번 달에만 표시)
  const monthPrefix = `${calBase.getFullYear()}-${pad2(calBase.getMonth() + 1)}-`;
  const stats = MEMBERS.map((m) => {
    const days = new Set(entries.filter((e) => e.m === m.id && e.day.startsWith(monthPrefix)).map((e) => e.day)).size;
    const line = calOff === 0
      ? `이번 달 ${days}일 · 연속 ${streakOf(m.id, byDay)}일`
      : `${calBase.getMonth() + 1}월 ${days}일`;
    return { m, line };
  });

  const cells = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<button key={'lead' + i} className="cal-cell" style={{ visibility: 'hidden' }} />);
  }
  for (let n = 1; n <= daysIn; n++) {
    const k = dayKey(new Date(calBase.getFullYear(), calBase.getMonth(), n));
    const isToday = k === todayKey;
    const isSel = k === selDay;
    const isFuture = k > todayKey;
    const dayEntries = (byDay.get(k) ?? []).slice().sort((a, b) => a.time.localeCompare(b.time));
    const dots = MEMBERS.filter((m) => dayEntries.some((e) => e.m === m.id));
    cells.push(
      <button key={k}
        className={'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
        onClick={() => setSelDay(k)}>
        <span className="cal-num">{n}</span>
        {/* 와이드: 멤버·태그 알약 / 모바일: 색 점 (CSS로 전환) */}
        <span className="cal-pills">
          {dayEntries.slice(0, MAX_PILLS).map((e) => {
            const mm = BY_ID[e.m] ?? MEMBERS[0]!;
            // 알약은 한 줄이라 색은 대표 태그 하나로 정하고, 나머지는 라벨에만 이어 붙인다
            const tags = entryTags(e);
            const tm = TAGMETA[primaryTag(tags)];
            return (
              <span key={e.id} className="cal-pill" style={{ background: tm.bg }}>
                <span className="cal-pill-dot" style={{ background: mm.color }} />
                <span className="cal-pill-label" style={{ color: tm.fg }}>
                  {mm.name} {tags.join('·')}
                </span>
              </span>
            );
          })}
          {dayEntries.length > MAX_PILLS && (
            <span className="cal-more">+{dayEntries.length - MAX_PILLS}개 더</span>
          )}
        </span>
        <span className="cal-day-dots">
          {dots.map((m) => (
            <span key={m.id} className="cal-day-dot" style={{ background: m.color }} />
          ))}
        </span>
      </button>,
    );
  }

  const selList = (byDay.get(selDay) ?? []).slice().sort((a, b) => b.time.localeCompare(a.time));
  const selMembers = MEMBERS.filter((m) => selList.some((e) => e.m === m.id));
  const selD = new Date(selDay + 'T12:00:00');

  return (
    <div>
      <div className="cal-head">
        <div className="cal-head-left">
          <div className="cal-title">{calBase.getFullYear()}년 {calBase.getMonth() + 1}월</div>
          {calOff !== 0 && (
            <button className="cal-today-btn" onClick={() => { setCalOff(0); setSelDay(todayKey); }}>오늘</button>
          )}
        </div>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setCalOff(calOff - 1)}>
            <Icon d="M15 6l-6 6 6 6" size={17} sw={2.4} />
          </button>
          <button className="icon-btn" onClick={() => setCalOff(calOff + 1)}>
            <Icon d="M9 6l6 6-6 6" size={17} sw={2.4} />
          </button>
        </div>
      </div>
      <div className="cal-stats">
        {stats.map(({ m, line }) => (
          <div key={m.id} className="cal-stat">
            <Avatar m={m} size={30} />
            <div className="cal-stat-main">
              <div className="cal-stat-name">
                <span>{m.name}</span>
                {m.id === meId && <span className="me-badge">나</span>}
              </div>
              <div className="cal-stat-line">{line}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="cal-week">
        {W.map((d, i) => (
          <span key={d} className={'cal-wd' + (i === 0 ? ' sun' : '')}>{d}</span>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>
      <div className="sel-head">
        <span className="sel-label">{selD.getMonth() + 1}월 {selD.getDate()}일 ({W[selD.getDay()]})</span>
        <span className="sel-count">기록 {selList.length}개</span>
        <span className="group-line" />
        <span className="sel-avatars">
          {selMembers.map((m) => (
            <Avatar key={m.id} m={m} size={24} className="sel-av" bg={m.soft} />
          ))}
        </span>
      </div>
      {selList.length === 0 && <div className="sel-empty">{wit.calEmpty}</div>}
      <div>
        {selList.map((e) => (
          <EntryCard key={e.id} e={e} compact mine={e.m === meId} meId={meId}
            editing={e.id === editingId} comments={comments.get(e.id) ?? []}
            reactions={reactions.get(e.id) ?? []} actions={actions} />
        ))}
      </div>
    </div>
  );
}
