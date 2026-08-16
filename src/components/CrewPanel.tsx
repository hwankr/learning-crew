/* 크루 패널 — 체크인 · 오늘의 크루 · 이번 달 요약 · 동기화 한 줄.
   데스크톱에서는 접히는 왼쪽 열이고, 좁은 화면에서는 본문 위에 그대로 선다. */
import type { Entry, MemberId, MemberStatus, Place } from '../../shared/types';
import { MEMBERS, dayKey, pad2, type CopySet } from '../lib/constants';
import { daysOf, monthDaysOf, streakOf } from '../lib/stats';
import type { PhotoUploadInfo, SyncInfo } from '../local/store';
import { Avatar } from './icons';
import { Board, MeBadge } from './Board';
import { StatusBar } from './StatusBar';
import { SyncStatus } from './SyncStatus';

/** 이번 달 요약 — 캘린더 머리에 있던 카드를 여기로 옮겨 왔다.
    보고 있는 달과 무관하게 늘 이번 달이다: 연속일이 오늘 기준이라 다른 달 옆에 두면
    "3월 요약인데 연속 12일"처럼 읽힌다. */
function MonthSummary({ entries, meId, today }: { entries: Entry[]; meId: MemberId; today: Date }) {
  const prefix = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-`;
  return (
    <div className="mon">
      <div className="mon-title">이번 달</div>
      {MEMBERS.map((m) => {
        const days = daysOf(entries, m.id);
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
  entries, todays, statuses, meId, now, today, wit, sync, photoUploads, onSetStatus, onOpenPhoto,
}: {
  entries: Entry[];
  todays: Entry[];
  statuses: Partial<Record<MemberId, MemberStatus>>;
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
}) {
  return (
    <>
      <StatusBar status={statuses[meId]} wit={wit} now={now} onSet={onSetStatus} />
      <Board todays={todays} statuses={statuses} now={now} todayKey={dayKey(today)}
        meId={meId} wit={wit}
        photoUploads={photoUploads} onOpenPhoto={onOpenPhoto} />
      <MonthSummary entries={entries} meId={meId} today={today} />
      {sync && <SyncStatus sync={sync} variant="panel" />}
    </>
  );
}
