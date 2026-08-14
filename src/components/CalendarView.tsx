import type { CSSProperties } from 'react';
import type { Comment, Entry, MemberId, ReactionSet } from '../../shared/types';
import { entryTags, primaryTag } from '../../shared/types';
import {
  MEMBERS, TAGMETA, W, dayKey, memberOf, membersOfEntries, pad2, shiftKey, type CopySet,
} from '../lib/constants';
import { Avatar, Icon } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 셀 하나에 보여줄 최대 알약 수 — 넘치면 "+N개 더". */
const MAX_PILLS = 3;

/** 넓은 와이드에서 월 요약 카드의 열 수 — 마지막 줄에 한 장만 남지 않는 배치를 고른다.
    (좁은 폭은 CSS가 2열로 고정한다. 카드는 grow하지 않으므로 열 수가 곧 카드 폭이다.)
    4명 이하는 한 줄에 다 서고, 5·6명은 3열(3+2 / 3+3), 3열이면 마지막이 한 장 남는
    7·10명만 4열로 간다. */
function statCols(n: number): number {
  if (n <= 4) return Math.max(1, n);
  return n % 3 === 1 ? 4 : 3;
}

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
    // 점은 기록에서 뽑는다 — 명부로 거르면 모르는 멤버만 기록한 날에 점이 하나도 안 찍혀
    // "아무도 기록 안 한 날"이 된다 (알약은 이미 memberOf라 그 셀 안에서도 어긋난다)
    const dots = membersOfEntries(dayEntries);
    cells.push(
      <button key={k}
        className={'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
        onClick={() => setSelDay(k)}>
        <span className="cal-num">{n}</span>
        {/* 와이드: 멤버·태그 알약 / 모바일: 색 점 (CSS로 전환) */}
        <span className="cal-pills">
          {dayEntries.slice(0, MAX_PILLS).map((e) => {
            // 모르는 멤버 id는 중립 표시로 — 알약의 점 색·이름이 남의 것이 되면 안 된다
            const mm = memberOf(e.m);
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
  const selMembers = membersOfEntries(selList); // 헤더 아바타도 같은 규칙 — 아래 카드와 인원이 맞아야 한다
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
      <div className="cal-stats" style={{ '--cols': statCols(stats.length) } as CSSProperties}>
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
