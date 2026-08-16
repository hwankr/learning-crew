import type { Comment, CrewEvent, Entry, MemberId, ReactionSet } from '../../shared/types';
import { entryTags, primaryTag } from '../../shared/types';
import {
  MEMBERS, W, dayKey, memberOf, membersOfEntries, pad2, tagMeta, type CopySet,
} from '../lib/constants';
import {
  eventDdayLabel, eventMembers, eventParticipants, eventPhase, eventSpanLabel, eventsByDay,
  eventsDayMembers, participantsLabel,
} from '../lib/events';
import { calOffOf, sameDayInMonth } from '../lib/uiState';
import type { PhotoUploadInfo } from '../local/store';
import { Avatar, Icon, PLUS_D } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 셀 하나에 보여줄 최대 알약 수 — 넘치면 "+N개 더".
    일정과 기록이 이 예산을 함께 쓴다: 일정이 먼저고 남는 자리를 기록이 받는다.
    ("동그라미는 기록, 네모는 일정" — 약속은 지나가면 끝이라 놓치면 손해가 크다) */
const MAX_PILLS = 3;
/** 격자는 늘 42칸(6주) — 뒤를 빈 칸으로 채워 5주 달과 6주 달 사이에 높이가 튀지 않게 한다.
    선행 공백(최대 6) + 날짜(최대 31)는 37칸이라 항상 이 안에 들어온다. */
const CELLS = 42;

export function CalendarView({
  entries, events, selDay, setSelDay, todayKey, meId, editingId, comments, reactions, photoUploads,
  wit, actions, onOpenEventSheet, onDeleteEvent,
}: {
  entries: Entry[];
  events: CrewEvent[];
  selDay: string;
  setSelDay: (k: string) => void;
  todayKey: string;
  meId: MemberId;
  editingId: string | null;
  comments: Map<string, Comment[]>;
  reactions: Map<string, ReactionSet[]>;
  photoUploads: Map<string, PhotoUploadInfo>;
  wit: CopySet;
  actions: EntryActions;
  /** 등록 시트를 그 날로 미리 채워 연다 */
  onOpenEventSheet: (day: string) => void;
  /** 삭제는 확인을 거친다 — 물음과 토스트는 App이 맡는다(기록 삭제와 같은 규칙) */
  onDeleteEvent: (ev: CrewEvent) => void;
}) {
  const now = new Date();
  // 달 이동이 선택일도 함께 옮기는 지금은 선택일이 화면 달의 단일 원본이다. calOff를 별도
  // state로 두면 자정에 기준 달만 바뀌어 격자와 패널이 다시 서로 다른 달을 가리킨다.
  const calOff = calOffOf(selDay, now);
  const calBase = new Date(now.getFullYear(), now.getMonth() + calOff, 1);
  const daysIn = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 0).getDate();
  const lead = calBase.getDay();
  const monthPrefix = `${calBase.getFullYear()}-${pad2(calBase.getMonth() + 1)}`;
  const monthCount = entries.filter((e) => e.day.startsWith(monthPrefix)).length;

  // 달을 넘길 때 선택일도 같은 일(日)로 따라간다 — 격자만 넘어가면 옆 패널이 딴 달을 가리킨다
  const shiftMonth = (step: number) => {
    const base = new Date(calBase.getFullYear(), calBase.getMonth() + step, 1);
    setSelDay(sameDayInMonth(base, selDay));
  };

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }
  // 기간 일정은 걸친 모든 날에 들어간다 — 시작일에만 찍으면 시험 기간이 하루로 읽힌다
  const evByDay = eventsByDay(events);
  // 이 달에 걸린 일정이 하나도 없으면 범례를 그리지 않는다 — 없는 것을 설명할 이유가 없다
  const monthHasEvent = [...evByDay.keys()].some((k) => k.startsWith(monthPrefix));

  const cells = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<span key={'lead' + i} className="cal-cell blank" aria-hidden="true" />);
  }
  for (let n = 1; n <= daysIn; n++) {
    const k = dayKey(new Date(calBase.getFullYear(), calBase.getMonth(), n));
    const isToday = k === todayKey;
    const isSel = k === selDay;
    const isFuture = k > todayKey;
    // 세 개만 남기므로 최신 기록부터 — 오래된 세 개를 고정하면 뒤에 온 기록은 +N에만 묻힌다
    const dayEntries = (byDay.get(k) ?? []).slice().sort((a, b) => b.time.localeCompare(a.time));
    const dayEvents = evByDay.get(k) ?? [];
    // 점은 기록에서 뽑는다 — 명부로 거르면 모르는 멤버만 기록한 날에 점이 하나도 안 찍혀
    // "아무도 기록 안 한 날"이 된다 (알약은 이미 memberOf라 그 셀 안에서도 어긋난다)
    const dots = membersOfEntries(dayEntries);
    // 일정 점은 참여자에서 뽑는다 — 등록자 하나로 찍으면 셋이 함께 치는 시험이 한 사람 일이 된다
    const eventDayMembers = eventsDayMembers(dayEvents);
    const overflow = dayEvents.length + dayEntries.length - MAX_PILLS;
    cells.push(
      <button key={k}
        className={'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
        aria-pressed={isSel}
        aria-current={isToday ? 'date' : undefined}
        onClick={() => setSelDay(k)}>
        <span className="cal-num">{n}</span>
        {/* 와이드: 멤버·태그 알약 / 모바일: 색 점 (CSS로 전환) */}
        <span className="cal-pills">
          {dayEvents.slice(0, MAX_PILLS).map((ev) => (
            // 옷(지남·임박·그 밖)은 클래스가 입히고, 점만 사람의 색을 쓴다.
            // 알약은 일정당 하나라 점도 하나다 — 여럿이 함께하는 일정은 대표(크루 차례 첫 사람)로
            // 끊는다. 누가 함께하는지는 아래 선택일 패널의 아바타 스택이 말한다.
            <span key={ev.id} className={'cal-pill ev ' + eventPhase(ev, todayKey)}>
              <span className="cal-pill-dot"
                style={{ background: memberOf(eventParticipants(ev)[0] ?? ev.m).color }} />
              <span className="cal-pill-label">
                {eventDdayLabel(ev, todayKey)} {ev.title}
              </span>
            </span>
          ))}
          {dayEntries.slice(0, Math.max(0, MAX_PILLS - dayEvents.length)).map((e) => {
            // 모르는 멤버 id는 중립 표시로 — 알약의 점 색·이름이 남의 것이 되면 안 된다
            const mm = memberOf(e.m);
            // 알약은 한 줄이라 색도 라벨도 대표 태그 하나로 끊는다 —
            // 태그를 다 이어 붙이면 142px 셀에서 이름이 먼저 말줄임으로 잘린다
            const tag = primaryTag(entryTags(e));
            const tm = tagMeta(tag);
            return (
              <span key={e.id} className="cal-pill" style={{ background: tm.bg }}>
                <span className="cal-pill-dot" style={{ background: mm.color }} />
                <span className="cal-pill-label" style={{ color: tm.fg }}>
                  {mm.name} {tag}
                </span>
              </span>
            );
          })}
          {overflow > 0 && <span className="cal-more">+{overflow}개 더</span>}
        </span>
        {/* 일정 네모가 기록 동그라미보다 앞이다 — 좁은 셀에서 줄이 바뀌어도 약속이 먼저 보인다.
            네모 하나가 일정 하나가 아니라 사람 하나다(기록 동그라미와 같은 문법): 그 날 일정들의
            참여자를 합쳐 사람별로 한 번씩만 찍는다 — 셋이 함께 치는 시험은 네모 셋이다. */}
        <span className="cal-day-dots">
          {eventDayMembers.map((m) => (
            <span key={m.id} className="cal-day-dot ev" style={{ background: m.color }} />
          ))}
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
  const selEvents = evByDay.get(selDay) ?? [];
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
          {/* 와이드는 라벨이 붙은 알약, 좁은 화면은 + 원형 하나 — 라벨만 CSS로 접는다.
              머리의 버튼은 보고 있는 달과 무관하게 오늘로 연다 — 날을 고른 뒤 등록하는 길은
              아래 선택일 패널의 입구가 맡는다(거기서는 그 날이 채워진다) */}
          <button className="cal-event-btn" aria-label="일정 등록" onClick={() => onOpenEventSheet(todayKey)}>
            <Icon d={PLUS_D} size={13} sw={2.4} />
            <span className="cal-event-btn-label">일정 등록</span>
          </button>
          <button className="cal-today-btn" onClick={() => setSelDay(todayKey)}>
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
          {/* 모양이 곧 뜻이다 — 동그라미는 기록, 네모는 일정. 격자에는 글자가 들어갈 자리가 없다 */}
          {monthHasEvent && (
            <div className="cal-legend">
              <span className="cal-legend-key"><span className="cal-legend-dot" />기록</span>
              <span className="cal-legend-key"><span className="cal-legend-dot ev" />일정</span>
              <span className="spacer" />
              <span className="cal-legend-hint">눌러서 그 날 보기</span>
            </div>
          )}
        </div>
        <div className="cal-sel">
          <div className="sel-head">
            <span className="sel-label">{selD.getMonth() + 1}월 {selD.getDate()}일 ({W[selD.getDay()]})</span>
            <span className="sel-count">
              기록 {selList.length}개{selEvents.length > 0 && ` · 일정 ${selEvents.length}개`}
            </span>
            <span className="spacer" />
            <span className="sel-avatars">
              {selMembers.map((m) => (
                <Avatar key={m.id} m={m} size={22} className="sel-av" bg={m.soft} />
              ))}
            </span>
            <button className="sel-event-add" onClick={() => onOpenEventSheet(selDay)}>+ 일정 등록</button>
          </div>
          {/* 일정이 기록 위에 선다 — 앞으로 할 일이 지난 하루의 요약보다 먼저 눈에 들어와야 한다 */}
          {selEvents.length > 0 && (
            <div className="sel-events">
              {selEvents.map((ev) => {
                // 색칩 자리를 아바타 스택이 대신 받는다 — 누구의 약속인지가 색 하나보다 먼저다
                const who = eventMembers(ev);
                return (
                  <div key={ev.id} className="sel-event">
                    <span className="sel-event-avatars">
                      {who.map((m) => (
                        <Avatar key={m.id} m={m} size={22} className="sel-av" bg={m.soft} />
                      ))}
                    </span>
                    <span className="sel-event-main">
                      <span className="sel-event-title">{ev.title}</span>
                      {/* 한 줄에 다 싣고 넘치면 말줄임 — 기간과 메모는 여기 말고 설 자리가 없다 */}
                      <span className="sel-event-by">
                        {participantsLabel(who)} · 일정
                        {ev.endDay && ` · ${eventSpanLabel(ev.day, ev.endDay)}`}
                        {ev.memo && ` · ${ev.memo}`}
                      </span>
                    </span>
                    <span className={'sel-event-dday ' + eventPhase(ev, todayKey)}>
                      {eventDdayLabel(ev, todayKey)}
                    </span>
                    {/* 지우는 것은 등록한 사람뿐 — 남의 약속을 캘린더에서 치울 수는 없다 */}
                    {ev.m === meId && (
                      <button className="entry-act del sel-event-del" onClick={() => onDeleteEvent(ev)}>
                        삭제
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {selList.length === 0 ? (
            <div className="sel-empty">{wit.calEmpty}</div>
          ) : (
            <div className="sel-list">
              {selList.map((e) => (
                <EntryCard key={e.id} e={e} compact mine={e.m === meId} meId={meId}
                  editing={e.id === editingId} comments={comments.get(e.id) ?? []}
                  reactions={reactions.get(e.id) ?? []} photoUploads={photoUploads}
                  actions={actions} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
