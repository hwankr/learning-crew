import type { Comment, CrewEvent, Entry, MemberId, ReactionSet } from '../../shared/types';
import { entryTags, primaryTag } from '../../shared/types';
import {
  MEMBERS, W, dayKey, memberOf, membersOfEntries, pad2, tagMeta, type CopySet,
} from '../lib/constants';
import {
  eventDdayLabel, eventMembers, eventParticipants, eventPhase, eventSpanLabel, eventWhenLabel,
  eventsByDay, eventsDayMembers, participantsLabel, upcomingEvent,
} from '../lib/events';
import { useIsDesktop } from '../lib/useMediaQuery';
import { calOffOf, sameDayInMonth } from '../lib/uiState';
import type { PhotoUploadInfo } from '../local/store';
import { Chip } from './Chip';
import { Avatar, Icon, PLUS_D } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

/** 셀 하나에 보여줄 최대 알약 수 — 넘치면 "+N개 더".
    일정과 기록이 이 예산을 함께 쓴다: 일정이 먼저고 남는 자리를 기록이 받는다.
    ("동그라미는 기록, 네모는 일정" — 약속은 지나가면 끝이라 놓치면 손해가 크다) */
const MAX_PILLS = 3;
/** 격자는 늘 42칸(6주) — 뒤를 빈 칸으로 채워 5주 달과 6주 달 사이에 높이가 튀지 않게 한다.
    선행 공백(최대 6) + 날짜(최대 31)는 37칸이라 항상 이 안에 들어온다. */
const CELLS = 42;

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

/** 와이드 오른쪽 열 맨 위에 서는 일정 하나 — 고른 날에 일정이 있으면 그 날의 첫 일정이고,
    없으면 다가오는 다음 일정이다(라벨이 둘을 가른다). 둘 다 없으면 카드를 세우지 않는다:
    빈 카드는 선택일 목록을 아래로 밀기만 한다.
    "이 날"이 "다가오는"보다 먼저인 이유: 사용자가 방금 고른 날이 화면의 주제다. */
export function topEventOf(
  selEvents: readonly CrewEvent[],
  upcoming: CrewEvent | null,
): { ev: CrewEvent; label: string } | null {
  const onDay = selEvents[0];
  if (onDay) return { ev: onDay, label: '이 날의 일정' };
  return upcoming ? { ev: upcoming, label: '다가오는 일정' } : null;
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
  // 배너·카드도 필터를 탄다 — '웅'만 켠 화면이 태현의 시험을 D-2로 알리면 필터가 거짓말이 된다
  const nextEvent = upcomingEvent(shownEvents, todayKey);
  const topEvent = topEventOf(selEvents, nextEvent);

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
          {/* 다가오는 일정 하나 — 홈 배너(CrewPanel)와 같은 말이지만 이쪽은 필터를 탄다.
              남은 일정이 없으면 접는다: 빈 카드는 격자 위 자리만 먹는다. */}
          {!desktop && nextEvent && (
            <button className={'cal-banner ' + eventPhase(nextEvent, todayKey)}
              onClick={() => setSelDay(nextEvent.day)}>
              <span className="cal-banner-bar" aria-hidden="true" />
              <span className="cal-banner-dday">{eventDdayLabel(nextEvent, todayKey)}</span>
              <span className="cal-banner-main">
                <span className="cal-banner-title">{nextEvent.title}</span>
                <span className="cal-banner-sub">
                  {participantsLabel(eventMembers(nextEvent))} · {eventWhenLabel(nextEvent.day, nextEvent.endDay)}
                </span>
              </span>
              <Chip tag={nextEvent.tag} variant="sm2" />
            </button>
          )}
          <div className="cal-week">
            {W.map((d, i) => (
              <span key={d} className={'cal-wd' + (i === 0 ? ' sun' : '')}>{d}</span>
            ))}
          </div>
          <div className="cal-grid">{cells}</div>
          {/* 모양이 곧 뜻이다 — 동그라미는 기록, 네모는 일정. 격자에는 글자가 들어갈 자리가 없다.
              두 셸 모두 늘 선다: 이 줄의 밑선이 격자와 그 아래를 가르는 구분선이라, 일정 없는
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
          {/* 와이드 전용 — 오른쪽 열의 첫 자리는 "언제까지 얼마나 남았나"가 가져간다.
              좁은 화면에서 격자 위에 서는 D-day 배너와 같은 말이되, 열이 넓어 숫자를 크게 세우고
              참여자·태그·메모까지 편다(디자인). 노드 자체를 와이드에서만 그리므로 이 스타일에는
              미디어 쿼리가 없다 — 모바일 전용 노드와 같은 규약이다. */}
          {desktop && topEvent && (
            <>
              <div className="cal-top-label">
                <span>{topEvent.label}</span>
                <span className="cal-top-rule" aria-hidden="true" />
              </div>
              <button className={'cal-top-card ' + eventPhase(topEvent.ev, todayKey)}
                onClick={() => setSelDay(topEvent.ev.day)}>
                <span className="cal-top-head">
                  <span className="cal-top-dday">{eventDdayLabel(topEvent.ev, todayKey)}</span>
                  <span className="cal-top-when">
                    {eventWhenLabel(topEvent.ev.day, topEvent.ev.endDay)}
                  </span>
                </span>
                <span className="cal-top-title">{topEvent.ev.title}</span>
                <span className="cal-top-by">
                  <span className="sel-event-avatars">
                    {eventMembers(topEvent.ev).map((m) => (
                      <Avatar key={m.id} m={m} size={20} className="sel-av" bg={m.soft} />
                    ))}
                  </span>
                  <span className="cal-top-names">{participantsLabel(eventMembers(topEvent.ev))}</span>
                  <Chip tag={topEvent.ev.tag} variant="sm2" />
                </span>
                {topEvent.ev.memo && <span className="cal-top-memo">{topEvent.ev.memo}</span>}
              </button>
            </>
          )}
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
