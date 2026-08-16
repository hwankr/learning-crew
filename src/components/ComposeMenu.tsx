/* "+ 작성하기" 선택 메뉴 — 캘린더에서 고른 날에 무엇을 남길지 두 갈래로 묻는다.
   좁은 화면에는 상단 바 CTA가 없어서 "그 날의 기록"으로 가는 길이 여기뿐이다: 기록이든
   일정이든 고른 날짜가 그대로 채워진다(오늘로 되돌아가면 날을 고른 뜻이 사라진다).
   모달 규약은 다른 시트와 같다 — 포커스 트랩·Escape·오버레이 클릭으로 닫기. */
import { useEffect, useId, useRef, type RefObject } from 'react';
import { dayLabel } from '../lib/events';
import { useFocusTrap } from '../lib/useFocusTrap';
import { Icon, RIGHT_D, X_D } from './icons';

export function ComposeMenu({
  day, fallbackRef, onEntry, onEvent, onClose,
}: {
  /** 캘린더에서 고른 날 — 두 갈래 모두 이 날로 열린다 */
  day: string;
  /** 메뉴를 연 버튼이 닫는 사이 사라질 수 있다 — 그때 초점이 갈 자리 */
  fallbackRef: RefObject<HTMLElement | null>;
  onEntry: () => void;
  onEvent: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(sheetRef, fallbackRef);

  /* 열리면 첫 갈래가 초점을 받는다 — 다른 시트는 첫 입력이 autoFocus로 가져가는 자리를,
     입력이 없는 이 메뉴는 여기서 대신 맡는다. 초점이 밖에 남으면 Escape 말고는 키보드로
     들어올 길이 없다(트랩은 Tab만 가둔다). 확인창과 달리 되돌릴 수 없는 갈래가 없어서
     맨 앞 항목에 그대로 준다(삭제 확인은 안전한 쪽인 '취소'에 준다). */
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay compose-overlay" onClick={onClose}>
      <div className="sheet menu-sheet" ref={sheetRef} role="dialog" aria-modal="true"
        aria-labelledby={titleId} onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head-row">
          <h2 className="sheet-title" id={titleId}>{dayLabel(day)}에 남기기</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="닫기">
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        <div className="menu-row-list">
          {/* 기록이 먼저다 — 매일 있는 일이 가끔 있는 약속보다 앞에 선다 */}
          <button className="menu-row" ref={firstRef} onClick={onEntry}>
            <span className="menu-row-main">
              <span className="menu-row-title">기록 남기기</span>
              <span className="menu-row-sub">그 날의 공부 일지를 남겨요</span>
            </span>
            <Icon d={RIGHT_D} size={16} sw={2.2} />
          </button>
          <button className="menu-row" onClick={onEvent}>
            <span className="menu-row-main">
              <span className="menu-row-title">일정 등록</span>
              <span className="menu-row-sub">크루 전원의 캘린더에 함께 보여요</span>
            </span>
            <Icon d={RIGHT_D} size={16} sw={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
