/* 크루 패널 — 체크인 · 다가오는 일정 · 오늘의 크루 · 이번 달 요약 · 동기화 한 줄.
   데스크톱에서는 접히는 왼쪽 열이고, 좁은 화면에서는 본문 위에 그대로 선다. */
import type { CrewEvent, Entry, MemberId, MemberStatus, Place } from '../../shared/types';
import { MEMBERS, dayKey, pad2, type CopySet } from '../lib/constants';
import {
  eventDdayLabel, eventMembers, eventPhase, eventWhenLabel, participantsLabel, upcomingEvent,
} from '../lib/events';
import { monthDaysOf, streakOf, studyDaysOf } from '../lib/stats';
import type { PhotoUploadInfo, SyncInfo } from '../local/store';
import { Avatar, Icon, RIGHT_D } from './icons';
import { Board, MeBadge } from './Board';
import { StatusBar } from './StatusBar';
import { SyncStatus } from './SyncStatus';
import { PixelStudyRoom } from './PixelStudyRoom';

/** 다가오는 일정 — 홈(좁은 화면)과 데스크톱 왼쪽 패널이 같은 자리를 쓴다.
    캘린더 탭까지 들어가야 알 수 있는 약속이라면 있으나 마나다: 매일 보는 자리에 하나만 띄운다.
    남은 일정이 없으면 배너는 접고 등록 입구만 남긴다 — 빈 카드는 자리만 먹는다. */
function EventLead({
  events, todayKey, onOpen, onGo,
}: {
  events: CrewEvent[];
  todayKey: string;
  onOpen: () => void;
  onGo: (ev: CrewEvent) => void;
}) {
  const next = upcomingEvent(events, todayKey);
  // 배너는 한 줄짜리 카드다 — 누가 함께하는지는 아바타가 먼저 말하고 이름은 요약으로 받는다
  const who = next ? eventMembers(next) : [];
  return (
    <div className="evlead">
      <div className="evlead-head">
        <span className="evlead-title">다가오는 일정</span>
        <span className="spacer" />
        <button className="evlead-add" onClick={onOpen}>+ 일정 등록</button>
      </div>
      {next && (
        <button className="evcard" onClick={() => onGo(next)}>
          <span className={'evcard-dday ' + eventPhase(next, todayKey)}>
            {eventDdayLabel(next, todayKey)}
          </span>
          <span className="evcard-main">
            <span className="evcard-title">{next.title}</span>
            <span className="evcard-by">
              <span className="evcard-avatars">
                {who.map((m) => (
                  <Avatar key={m.id} m={m} size={16} className="evcard-av" bg={m.soft} />
                ))}
              </span>
              {/* 말줄임은 글자 쪽에만 건다 — 자리가 좁아도 아바타는 줄지 않는다 */}
              <span className="evcard-by-text">
                {participantsLabel(who)} · {eventWhenLabel(next.day, next.endDay)}
              </span>
            </span>
          </span>
          <Icon d={RIGHT_D} size={15} sw={2.2} />
        </button>
      )}
    </div>
  );
}

/** 이번 달 요약 — 캘린더 머리에 있던 카드를 여기로 옮겨 왔다.
    보고 있는 달과 무관하게 늘 이번 달이다: 연속일이 오늘 기준이라 다른 달 옆에 두면
    "3월 요약인데 연속 12일"처럼 읽힌다.
    기록을 안 남긴 날도 체크인 도장("오늘 공부함")이면 센다 — 바로 위 오늘의 크루가
    도장으로 세는데 이 줄만 기록을 요구하면 체크인한 날의 숫자가 서로 어긋난다.
    도장 날짜는 KST 규약이고 월 접두사·연속일 기준은 기기 로컬이다 — 크루 전원이 KST라
    두 경계가 같다는 전제 위에 있다(기록의 day도 원래 기기 로컬 규약이라 여기만 못 바꾼다). */
function MonthSummary({
  entries, studyDays, statuses, meId, now, today,
}: {
  entries: Entry[];
  studyDays: Partial<Record<MemberId, ReadonlySet<string>>>;
  statuses: Partial<Record<MemberId, MemberStatus>>;
  meId: MemberId;
  now: number;
  today: Date;
}) {
  const prefix = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-`;
  return (
    <div className="mon">
      <div className="mon-title">이번 달</div>
      {MEMBERS.map((m) => {
        const days = studyDaysOf(entries, m.id, studyDays[m.id], statuses[m.id], now);
        return (
          <div key={m.id} className="mon-row">
            <Avatar m={m} size={24} />
            <span className="mon-nm">{m.name}</span>
            {m.id === meId && <MeBadge />}
            <span className="mon-line">
              {monthDaysOf(days, prefix)}일 · 연속 {streakOf(days, today)}일
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CrewPanel({
  entries, events, todays, statuses, studyDays, meId, now, today, wit, sync, photoUploads,
  onSetStatus, onOpenPhoto, onOpenEventSheet, onGoToEvent,
}: {
  entries: Entry[];
  events: CrewEvent[];
  todays: Entry[];
  statuses: Partial<Record<MemberId, MemberStatus>>;
  /** 멤버별 공부 시작 도장 날짜 이력 — 월 요약이 기록 날짜와 합쳐 센다 */
  studyDays: Partial<Record<MemberId, ReadonlySet<string>>>;
  meId: MemberId;
  /** 분 단위로 갱신되는 지금 시각 — 경과 표시가 멈추지 않게 App이 흘려 준다 */
  now: number;
  today: Date;
  wit: CopySet;
  /** null이면 동기화 줄을 그리지 않는다 — 데모(토큰 없음)에는 맞출 서버가 없다 */
  sync: SyncInfo | null;
  photoUploads: Map<string, PhotoUploadInfo>;
  onSetStatus: (on: boolean, place: Place | null) => void;
  onOpenPhoto: (e: Entry, photoId: string) => void;
  onOpenEventSheet: () => void;
  /** 배너를 누르면 캘린더로 옮겨 가 그 일정의 시작일을 고른다 */
  onGoToEvent: (ev: CrewEvent) => void;
}) {
  return (
    <>
      <StatusBar status={statuses[meId]} wit={wit} now={now} onSet={onSetStatus} />
      <PixelStudyRoom statuses={statuses} now={now} meId={meId} compact />
      <EventLead events={events} todayKey={dayKey(today)} onOpen={onOpenEventSheet} onGo={onGoToEvent} />
      <Board todays={todays} statuses={statuses} now={now} todayKey={dayKey(today)}
        meId={meId} wit={wit}
        photoUploads={photoUploads} onOpenPhoto={onOpenPhoto} />
      <MonthSummary entries={entries} studyDays={studyDays} statuses={statuses}
        meId={meId} now={now} today={today} />
      {sync && <SyncStatus sync={sync} variant="panel" />}
    </>
  );
}
