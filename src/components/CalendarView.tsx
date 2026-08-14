import type { Comment, Entry, MemberId, ReactionSet } from '../../shared/types';
import { entryTags, primaryTag } from '../../shared/types';
import {
  MEMBERS, TAGMETA, W, dayKey, memberOf, membersOfEntries, pad2, type CopySet,
} from '../lib/constants';
import { sameDayInMonth } from '../lib/uiState';
import { Avatar, Icon } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 셀 하나에 보여줄 최대 알약 수 — 넘치면 "+N개 더". */
const MAX_PILLS = 3;
/** 격자는 늘 42칸(6주) — 뒤를 빈 칸으로 채워 5주 달과 6주 달 사이에 높이가 튀지 않게 한다.
    선행 공백(최대 6) + 날짜(최대 31)는 37칸이라 항상 이 안에 들어온다. */
const CELLS = 42;

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
  const monthPrefix = `${calBase.getFullYear()}-${pad2(calBase.getMonth() + 1)}`;
  const monthCount = entries.filter((e) => e.day.startsWith(monthPrefix)).length;

  // 달을 넘길 때 선택일도 같은 일(日)로 따라간다 — 격자만 넘어가면 옆 패널이 딴 달을 가리킨다
  const shiftMonth = (step: number) => {
    const base = new Date(now.getFullYear(), now.getMonth() + calOff + step, 1);
    setCalOff(calOff + step);
    setSelDay(sameDayInMonth(base, selDay));
  };

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }

  const cells = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<span key={'lead' + i} className="cal-cell blank" aria-hidden="true" />);
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
            // 알약은 한 줄이라 색도 라벨도 대표 태그 하나로 끊는다 —
            // 태그를 다 이어 붙이면 142px 셀에서 이름이 먼저 말줄임으로 잘린다
            const tag = primaryTag(entryTags(e));
            const tm = TAGMETA[tag];
            return (
              <span key={e.id} className="cal-pill" style={{ background: tm.bg }}>
                <span className="cal-pill-dot" style={{ background: mm.color }} />
                <span className="cal-pill-label" style={{ color: tm.fg }}>
                  {mm.name} {tag}
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
  for (let i = cells.length; i < CELLS; i++) {
    cells.push(<span key={'tail' + i} className="cal-cell blank" aria-hidden="true" />);
  }

  const selList = (byDay.get(selDay) ?? []).slice().sort((a, b) => b.time.localeCompare(a.time));
  const selMembers = membersOfEntries(selList); // 헤더 아바타도 같은 규칙 — 아래 카드와 인원이 맞아야 한다
  const selD = new Date(selDay + 'T12:00:00');

  return (
    <div>
      <div className="cal-head">
        <div className="cal-head-text">
          <div className="cal-title">{calBase.getFullYear()}년 {calBase.getMonth() + 1}월</div>
          <div className="cal-meta">
            기록 {monthCount}개
            {/* 크루 수는 좁은 화면에서 접는다 — 모바일 머리는 두 줄이라 더 길어지면 안 된다 */}
            <span className="cal-meta-crew"> · 크루 {MEMBERS.length}명</span>
          </div>
        </div>
        <div className="cal-head-actions">
          <button className="cal-today-btn" onClick={() => { setCalOff(0); setSelDay(todayKey); }}>
            오늘
          </button>
          <div className="cal-nav">
            <button className="icon-btn" aria-label="이전 달" onClick={() => shiftMonth(-1)}>
              <Icon d="M15 6l-6 6 6 6" size={17} sw={2.4} />
            </button>
            <button className="icon-btn" aria-label="다음 달" onClick={() => shiftMonth(1)}>
              <Icon d="M9 6l6 6-6 6" size={17} sw={2.4} />
            </button>
          </div>
        </div>
      </div>
      {/* 와이드에서만 격자|패널 2열 — 좁은 화면은 격자 아래로 흐른다 (CSS) */}
      <div className="cal-layout">
        <div className="cal-grid-col">
          <div className="cal-week">
            {W.map((d, i) => (
              <span key={d} className={'cal-wd' + (i === 0 ? ' sun' : '')}>{d}</span>
            ))}
          </div>
          <div className="cal-grid">{cells}</div>
        </div>
        <div className="cal-sel">
          <div className="sel-head">
            <span className="sel-label">{selD.getMonth() + 1}월 {selD.getDate()}일 ({W[selD.getDay()]})</span>
            <span className="sel-count">기록 {selList.length}개</span>
            <span className="spacer" />
            <span className="sel-avatars">
              {selMembers.map((m) => (
                <Avatar key={m.id} m={m} size={22} className="sel-av" bg={m.soft} />
              ))}
            </span>
          </div>
          {selList.length === 0 ? (
            <div className="sel-empty">{wit.calEmpty}</div>
          ) : (
            <div className="sel-list">
              {selList.map((e) => (
                <EntryCard key={e.id} e={e} compact mine={e.m === meId} meId={meId}
                  editing={e.id === editingId} comments={comments.get(e.id) ?? []}
                  reactions={reactions.get(e.id) ?? []} actions={actions} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
