/* 데스크톱 알림 드롭다운 — 벨 아래 352px. 내역은 여기서만 읽고(전체 화면 NotiPage는
   <900px 전용), 톱니로 들어가는 설정만 본문 전체를 쓴다.
   표시 규칙(문구·배지·시각·all 접기)과 행 자체는 NotiPage와 같은 것을 쓴다 — 같은 알림이
   드롭다운과 모바일 내역에서 다르게 읽히면 안 된다. 필터 칩만 여기서 뺀다(좁다). */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Notification } from '../../shared/types';
import { dayKey } from '../lib/constants';
import { GearIcon } from './icons';
import { NotiRowView, displayAt, feedTargetOf, groupDayRows, readRow } from './NotiPage';

export function NotiDropdown({
  notifications, unread, bellRef, onRead, onReadAll, onOpenSettings, onOpenFeed, onClose,
}: {
  notifications: Notification[];
  unread: number;
  /** 바깥 클릭 판정에서 벨을 빼고(안 그러면 토글이 닫고-여는 왕복이 된다), Esc에 초점을 돌려준다 */
  bellRef: RefObject<HTMLButtonElement | null>;
  onRead: (id: string) => void;
  onReadAll: () => void;
  onOpenSettings: () => void;
  /** 행을 누르면 읽음 처리 후 대상이 있는 피드로 데려간다 — 대상이 기록이냐 라운지 글이냐를
      함께 넘겨, App이 그 대상이 보이는 쪽으로 필터를 풀게 한다 */
  onOpenFeed: (target: 'entry' | 'post') => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (boxRef.current?.contains(t) || bellRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      onClose();
      // 초점이 문서 맨 앞으로 떨어지지 않게 열었던 벨로 돌려준다
      bellRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellRef, onClose]);

  // 날짜 라벨은 두지 않지만 접기 규칙(같은 날의 크루 전체 댓글)은 날짜 단위라
  // 하루씩 묶어 접은 뒤 다시 이어 붙인다 — 스냅샷 순서(최신 먼저)가 그대로 유지된다
  const rows = useMemo(() => {
    const byDay = new Map<string, Notification[]>();
    for (const n of notifications) {
      const id = dayKey(new Date(displayAt(n)));
      const cur = byDay.get(id);
      if (cur) cur.push(n);
      else byDay.set(id, [n]);
    }
    return [...byDay.entries()].flatMap(([id, items]) => groupDayRows(items, id));
  }, [notifications]);

  return (
    <div className="noti-drop" ref={boxRef} role="dialog" aria-label="알림">
      <div className="noti-drop-head">
        <span className="noti-drop-title">알림</span>
        {unread > 0 && <span className="noti-drop-badge">{unread}</span>}
        <span className="spacer" />
        {unread > 0 && (
          <button className="noti-drop-mark" onClick={onReadAll}>모두 읽음</button>
        )}
        <button className="icon-btn" title="알림 설정" aria-label="알림 설정" onClick={onOpenSettings}>
          <GearIcon size={17} />
        </button>
      </div>
      <div className="noti-drop-list">
        {rows.length === 0 ? (
          <div className="noti-drop-empty">아직 알림이 없어요</div>
        ) : (
          rows.map((row) => (
            <NotiRowView key={row.key} row={row} compact
              expanded={!!open[row.key]}
              onExpand={() => setOpen((p) => ({ ...p, [row.key]: !p[row.key] }))}
              onActivate={() => {
                readRow(row, onRead);
                onOpenFeed(feedTargetOf(row.head));
              }} />
          ))
        )}
      </div>
    </div>
  );
}
