import { useEffect, useRef } from 'react';
import type { Comment, CrewEvent, Entry, MemberId, ReactionSet } from '../../shared/types';
import { MEMBERS, W, dayKey, memberOf, membersOfEntries, pad2, type CopySet } from '../lib/constants';
import {
  eventDdayLabel, eventMembers, eventParticipants, eventPhase, eventSpanLabel,
  eventsByDay, eventsDayMembers, participantsLabel,
} from '../lib/events';
import { useIsDesktop } from '../lib/useMediaQuery';
import { calOffOf, sameDayInMonth } from '../lib/uiState';
import type { PhotoUploadInfo } from '../local/store';
import { Chip } from './Chip';
import { Avatar, Icon, PLUS_D } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 격자는 늘 42칸(6주) — 뒤를 빈 칸으로 채워 5주 달과 6주 달 사이에 높이가 튀지 않게 한다.
    선행 공백(최대 6) + 날짜(최대 31)는 37칸이라 항상 이 안에 들어온다. */
const CELLS = 42;

/** 와이드 셀에 세우는 항목(일정 알약 + 기록 줄)의 최대 수 — 셀 높이가 고정이라 넘치면
    마지막 한 줄을 "+N"에 내준다. 무엇이 더 있었는지는 그 날을 고르면 옆 패널이 다 말한다. */
const MAX_CELL_ITEMS = 3;

/** 머리에 붙는 크루 이름 배지 — 좁은 셸에는 상단 바가 없어 여기가 "어디를 보고 있나"의
    유일한 자리이고, 와이드에서는 같은 문법을 캘린더 머리에도 한 번 더 세운다(디자인). */
const CREW_NAME = '러닝 크루';

/** 멤버 필터 — null이면 전체.
    기록은 쓴 사람으로, 일정은 참여자로 가른다: 남이 등록해 준 시험도 내가 치는 것이면
    내 달력에 남아야 한다(등록자로 거르면 그 날이 통째로 사라진다). */
export function entriesOfMember(entries: readonly Entry[], m: MemberId | null): Entry[] {
  return m === null ? [...entries] : entries.filter((e) => e.m === m);
}

export function eventsOfMember(events: readonly CrewEvent[], m: MemberId | null): CrewEvent[] {
  return m === null ? [...events] : events.filter((ev) => eventParticipants(ev).includes(m));
}

/** 머리 버튼 둘의 차례 — 와이드는 "일정 등록 → 오늘", 좁은 화면은 "오늘 → +"(이미지).
    돌려주는 id가 곧 React key다: 자리가 아니라 의미에 key가 붙어 있어야 폭이 900px 경계를
    넘어 차례가 뒤집힐 때 React가 노드를 옮긴다(자리로 재사용하면 초점이 그대로 남은 채
    버튼의 뜻만 바뀐다). 차례 자체는 CSS order가 아니라 DOM이 정한다 — 눈에 보이는 차례와
    Tab 차례가 같아야 한다. */
export type HeadAction = 'today' | 'event';

export function headActionOrder(desktop: boolean): HeadAction[] {
  return desktop ? ['event', 'today'] : ['today', 'event'];
}

/** 날짜 버튼이 낭독기에 읽히는 이름 — "8월 16일, 기록 3개, 일정 1개"(없는 쪽은 빼고,
    둘 다 없으면 날짜만). 세는 대상은 화면과 같다: 필터가 걸려 있으면 그 사람 것만이다.
    제목까지 싣지 않는 이유: 42칸을 훑는 낭독에서 한 칸이 길어지면 달 전체를 지나기가 힘들다 —
    무엇이었는지는 그 날을 고르면 선택일 패널이 말한다. */
export function cellLabel(month: number, day: number, entries: number, events: number): string {
  const parts = [`${month}월 ${day}일`];
  if (entries > 0) parts.push(`기록 ${entries}개`);
  if (events > 0) parts.push(`일정 ${events}개`);
  return parts.join(', ');
}

/** 이 달에 걸린 일정 수 — 기간 일정은 달을 걸치기만 해도 이 달의 일정이다.
    필터와 무관하게 늘 전체다(머리의 메타는 "이 달에 무엇이 있나"를 말한다). */
function monthEventCount(events: readonly CrewEvent[], monthPrefix: string, daysIn: number): number {
  const first = `${monthPrefix}-01`;
  const last = `${monthPrefix}-${pad2(daysIn)}`;
  return events.filter((ev) => ev.day <= last && (ev.endDay ?? ev.day) >= first).length;
}

export function CalendarView({
  entries, events, selDay, setSelDay, filterM, setFilterM, todayKey, meId, editingId, comments,
  reactions, photoUploads, wit, actions, onOpenEventSheet, onOpenCompose, onDeleteEvent,
}: {
  entries: Entry[];
  events: CrewEvent[];
  selDay: string;
  setSelDay: (k: string) => void;
  /** 멤버 필터 — null이면 전체. 셸이 갈리면 이 컴포넌트가 통째로 다시 마운트되므로 App이 든다
      (여기 로컬 state로 두면 900px 경계를 넘는 순간 고른 사람이 '전체'로 돌아간다) */
  filterM: MemberId | null;
  setFilterM: (m: MemberId | null) => void;
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
  /** 좁은 화면의 "+ 작성하기" — 기록이냐 일정이냐를 고르는 메뉴를 그 날로 연다 */
  onOpenCompose: (day: string) => void;
  /** 삭제는 확인을 거친다 — 물음과 토스트는 App이 맡는다(기록 삭제와 같은 규칙) */
  onDeleteEvent: (ev: CrewEvent) => void;
}) {
  /* 좁은 화면은 풀블리드 미니멀 격자(점 + D-day 배너)로, 와이드는 알약이 들어가는 큰 셀 +
     우측 선택일 열로 갈린다. 옷 차이는 CSS가 맡지만 여기 갈림은 "무엇을 그리는가"라
     렌더 중에 알아야 한다(알림 셸을 가르는 useIsDesktop과 같은 이유). */
  const desktop = useIsDesktop();
  const shownEntries = entriesOfMember(entries, filterM);
  const shownEvents = eventsOfMember(events, filterM);

  const now = new Date();
  // 달 이동이 선택일도 함께 옮기는 지금은 선택일이 화면 달의 단일 원본이다. calOff를 별도
  // state로 두면 자정에 기준 달만 바뀌어 격자와 패널이 다시 서로 다른 달을 가리킨다.
  const calOff = calOffOf(selDay, now);
  const calBase = new Date(now.getFullYear(), now.getMonth() + calOff, 1);
  const daysIn = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 0).getDate();
  const lead = calBase.getDay();
  const monthPrefix = `${calBase.getFullYear()}-${pad2(calBase.getMonth() + 1)}`;
  // 머리의 메타는 필터를 타지 않는다 — "이 달에 무엇이 있나"는 누구를 보고 있든 같은 수다
  const monthCount = entries.filter((e) => e.day.startsWith(monthPrefix)).length;
  const monthEvents = monthEventCount(events, monthPrefix, daysIn);

  /* 달이 넘어갔음을 알리는 도착 모션 — 42칸 격자는 달이 바뀌어도 생김새가 같아 숫자만 조용히
     바뀌면 넘어간 것을 놓친다. 새 격자를 즉시 그리고 그 위에 짧은 페이드+슬라이드만 얹으므로
     연타를 막지 않는다. 방향은 이전 렌더의 달과 비교해 얻는다: 화살표만이 아니라 '오늘'로
     점프해도 옳은 방향으로 움직이고, 같은 달 안의 이동(날짜 클릭)은 움직이지 않는다.
     ref 갱신은 effect에서 — 첫 렌더와 같은 달의 재렌더는 클래스가 비어 정적 마크업이 그대로다. */
  const prevMonthRef = useRef(monthPrefix);
  const slide = prevMonthRef.current === monthPrefix ? ''
    : prevMonthRef.current < monthPrefix ? ' cal-slide-next' : ' cal-slide-prev';
  useEffect(() => { prevMonthRef.current = monthPrefix; });

  // 달을 넘길 때 선택일도 같은 일(日)로 따라간다 — 격자만 넘어가면 옆 패널이 딴 달을 가리킨다
  const shiftMonth = (step: number) => {
    const base = new Date(calBase.getFullYear(), calBase.getMonth() + step, 1);
    setSelDay(sameDayInMonth(base, selDay));
  };

  const byDay = new Map<string, Entry[]>();
  for (const e of shownEntries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }
  // 기간 일정은 걸친 모든 날에 들어간다 — 시작일에만 찍으면 시험 기간이 하루로 읽힌다
  const evByDay = eventsByDay(shownEvents);

  const cells = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<span key={'lead' + i} className="cal-cell blank" aria-hidden="true" />);
  }
  for (let n = 1; n <= daysIn; n++) {
    const k = dayKey(new Date(calBase.getFullYear(), calBase.getMonth(), n));
    const isToday = k === todayKey;
    const isSel = k === selDay;
    const isFuture = k > todayKey;
    const dayEntries = byDay.get(k) ?? [];
    const dayEvents = evByDay.get(k) ?? [];
    // 점은 기록에서 뽑는다 — 명부로 거르면 모르는 멤버만 기록한 날에 점이 하나도 안 찍혀
    // "아무도 기록 안 한 날"이 된다
    const dots = membersOfEntries(dayEntries);
    // 일정 점은 참여자에서 뽑는다 — 등록자 하나로 찍으면 셋이 함께 치는 시험이 한 사람 일이 된다
    const eventDayMembers = eventsDayMembers(dayEvents);
    /* 와이드 셀의 항목 예산 — 일정이 기록보다 먼저다(약속이 먼저 보인다). 다 못 들어가면
       마지막 줄을 "+N"에 내주고 남는 자리만 채운다: 3개는 그대로 3줄, 4개부터 2줄 + "+2". */
    const cellTotal = dayEvents.length + dayEntries.length;
    const cellBudget = cellTotal > MAX_CELL_ITEMS ? MAX_CELL_ITEMS - 1 : MAX_CELL_ITEMS;
    const cellEvs = dayEvents.slice(0, cellBudget);
    const cellEns = dayEntries.slice()
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(0, cellBudget - cellEvs.length);
    cells.push(
      <button key={k}
        className={'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
        aria-pressed={isSel}
        aria-current={isToday ? 'date' : undefined}
        /* 눈으로는 점이 말하는 것을 귀로도 들려준다 — 라벨이 숫자뿐이면 낭독기로는
           42칸 어디에 기록·일정이 있는지 알 길이 없다(점은 색이라 읽히지 않는다) */
        aria-label={cellLabel(calBase.getMonth() + 1, n, dayEntries.length, dayEvents.length)}
        onClick={() => setSelDay(k)}>
        <span className="cal-num">{n}</span>
        {/* 와이드 셀은 자리가 있어 내용이 글자로 선다(노션식) — 일정은 제목 알약(임박·지남의
            색 규칙은 선택일 행과 같다), 기록은 "색 점 + 이름" 한 줄이다(태그까지 실으면
            42칸에서 줄이 소란해진다 — 무엇을 했는지는 그 날을 고르면 패널이 말한다).
            채운 알약은 약속, 점 달린 글줄은 기록 — 모양이 종류를 가르고 색은 사람 몫이다. */}
        {desktop && cellEvs.map((ev) => (
          <span key={ev.id} className={'cal-cell-ev ' + eventPhase(ev, todayKey)}>{ev.title}</span>
        ))}
        {desktop && cellEns.map((e) => {
          const m = memberOf(e.m);
          return (
            <span key={e.id} className="cal-cell-en">
              <span className="cal-cell-en-dot" style={{ background: m.color }} />
              <span className="cal-cell-en-text">{m.name}</span>
            </span>
          );
        })}
        {desktop && cellTotal > MAX_CELL_ITEMS && (
          <span className="cal-cell-more">+{cellTotal - cellBudget}</span>
        )}
        {/* 좁은 화면은 글자가 들어갈 자리가 없어 점으로 접는다 — 가로 막대는 일정(하나가
            사람 하나다: 그 날 일정들의 참여자를 합쳐 사람별로 한 번씩), 동그라미는 기록.
            와이드는 위의 글줄이 다 말하므로 점 줄 자체를 그리지 않는다. */}
        {!desktop && (
          <span className="cal-day-dots">
            {eventDayMembers.map((m) => (
              <span key={m.id} className="cal-day-dot ev" style={{ background: m.color }} />
            ))}
            {dots.map((m) => (
              <span key={m.id} className="cal-day-dot" style={{ background: m.color }} />
            ))}
          </span>
        )}
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
          <div className="cal-title-row">
            <div className="cal-title">{calBase.getFullYear()}년 {calBase.getMonth() + 1}월</div>
            <span className="cal-crew-badge">{CREW_NAME}</span>
          </div>
          <div className="cal-meta">
            기록 {monthCount}개 · 일정 {monthEvents}개
            {/* 크루 수만 좁은 화면에서 접는다 — 모바일 머리는 두 줄이라 더 길어지면 안 된다 */}
            <span className="cal-meta-crew"> · 크루 {MEMBERS.length}명</span>
          </div>
        </div>
        <div className="cal-head-actions">
          {/* 두 셸의 버튼 차례가 다르다(와이드: 일정 등록 → 오늘 / 좁은 화면: 오늘 → +).
              CSS order로 자리만 바꾸면 눈에 보이는 차례와 Tab 차례가 어긋나므로 DOM을 직접 나눈다.
              key는 자리가 아니라 의미(id)에 붙는다 — 900px 경계를 넘는 리사이즈에서 차례가
              뒤집힐 때 React가 자리로 노드를 재사용하면, '오늘'에 두었던 초점이 그대로
              '일정 등록' 버튼이 되어 다음 Enter가 누르는 것이 달라진다. */}
          {headActionOrder(desktop).map((id) => (id === 'today' ? (
            <button key={id} className="cal-today-btn" onClick={() => setSelDay(todayKey)}>
              오늘
            </button>
          ) : (
            /* 머리의 등록 버튼은 보고 있는 달과 무관하게 오늘로 연다 — 날을 고른 뒤 등록하는
               길은 아래 선택일 패널의 입구가 맡는다(거기서는 그 날이 채워진다).
               와이드는 라벨이 붙은 알약, 좁은 화면은 + 원형 하나 — 라벨만 CSS로 접는다. */
            <button key={id} className="cal-event-btn" aria-label="일정 등록"
              onClick={() => onOpenEventSheet(todayKey)}>
              <Icon d={PLUS_D} size={13} sw={2.4} />
              <span className="cal-event-btn-label">일정 등록</span>
            </button>
          )))}
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
          {/* 크루 다섯 명의 점·알약이 한 격자에 겹치면 내 것을 찾기가 어렵다. 고른 사람은
              격자·선택일 목록·위 카드(배너)까지 함께 따라간다(머리의 수만 전체 그대로).
              두 셸이 같은 줄을 쓰고 상태는 App이 든다 — 폭이 바뀌어도 고른 사람이 그대로 남는다. */}
          <div className="cal-filter" role="group" aria-label="멤버 필터">
            <button className={'cal-filter-chip' + (filterM === null ? ' on' : '')}
              aria-pressed={filterM === null} onClick={() => setFilterM(null)}>
              전체
            </button>
            {MEMBERS.map((m) => (
              // 켜도 점은 그 사람의 색 그대로다 — 검은 알약 위에서도 누구인지가 색으로 먼저 읽힌다
              <button key={m.id} className={'cal-filter-chip' + (filterM === m.id ? ' on' : '')}
                aria-pressed={filterM === m.id} onClick={() => setFilterM(m.id)}>
                <span className="cal-filter-dot" style={{ background: m.color }} />
                {m.name}
              </button>
            ))}
          </div>
          <div className="cal-week">
            {W.map((d, i) => (
              <span key={d} className={'cal-wd' + (i === 0 ? ' sun' : '')}>{d}</span>
            ))}
          </div>
          {/* key가 달이다 — 달이 바뀌면 격자가 새로 서면서 도착 모션이 다시 돈다
              (같은 방향 연타에도 매번 움직여야 "넘어갔다"가 매번 들린다) */}
          <div key={monthPrefix} className={'cal-grid' + slide}>{cells}</div>
          {/* 모양이 곧 뜻이다 — 동그라미는 기록, 가로 막대는 일정(좁은 화면의 점 문법).
              와이드는 셀이 스스로 말해 열쇠를 CSS로 접고 안내 문구만 남는다. 줄 자체는 두 셸
              모두 늘 선다: 이 줄의 밑선이 격자와 그 아래를 가르는 구분선이라, 일정 없는
              달에 통째로 접으면 안내와 함께 그 선까지 사라진다. */}
          <div className="cal-legend">
            <span className="cal-legend-key"><span className="cal-legend-dot" />기록</span>
            <span className="cal-legend-key"><span className="cal-legend-dot ev" />일정</span>
            <span className="spacer" />
            {/* 손가락과 마우스는 다른 말을 쓴다 — 같은 안내라도 셸마다 제 동사로 말한다 */}
            <span className="cal-legend-hint">{desktop ? '날짜를 눌러 상세 보기' : '터치하여 상세 보기'}</span>
          </div>
        </div>
        <div className="cal-sel">
          <div className="sel-head">
            <span className="sel-label">{selD.getMonth() + 1}월 {selD.getDate()}일 ({W[selD.getDay()]})</span>
            <span className="sel-count">
              {/* 좁은 화면은 0개라도 두 수를 나란히 둔다 — 자리가 사라졌다 나타나면 줄이 흔들린다 */}
              기록 {selList.length}개{(!desktop || selEvents.length > 0) && ` · 일정 ${selEvents.length}개`}
            </span>
            <span className="spacer" />
            <span className="sel-avatars">
              {selMembers.map((m) => (
                <Avatar key={m.id} m={m} size={22} className="sel-av" bg={m.soft} />
              ))}
            </span>
            {/* 고른 날에 무엇을 남길지부터 묻고 기록·일정 둘 다 그 날로 채운다 — 두 셸이 같은
                입구를 쓴다. 머리의 "일정 등록" 알약은 오늘로 여는 다른 길이라 그대로 남는다. */}
            <button className="sel-compose" onClick={() => onOpenCompose(selDay)}>+ 작성하기</button>
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
          {/* 좁은 화면의 빈 문구는 일정까지 함께 말한다(한 화면에 둘이 같이 서므로) — 일정만
              있는 날에 "기록이 없어요"만 뜨면 바로 위 목록과 어긋난다. */}
          {selList.length === 0 && (desktop || selEvents.length === 0) && (
            <div className="sel-empty">{desktop ? wit.calEmpty : wit.calEmptyDay}</div>
          )}
          {selList.length > 0 && (
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
