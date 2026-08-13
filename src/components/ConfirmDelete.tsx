import { useEffect, useId, useRef, type RefObject } from 'react';
import type { Entry } from '../../shared/types';
import { W, type CopySet } from '../lib/constants';
import { useFocusTrap } from '../lib/useFocusTrap';
import { Chip } from './Chip';

/** 기록 삭제 확인 — 삭제는 되돌릴 수 없고 다른 기기로도 곧장 퍼지니 한 번 묻는다.
    (댓글은 묻지 않는다 — 다시 달면 그만이다.)
    무엇이 지워지는지 보여준다: 피드·캘린더 어디서 눌렀든 카드가 화면 밖으로 밀릴 수 있다. */
export function ConfirmDelete({
  entry, wit, fallbackRef, onCancel, onConfirm,
}: {
  entry: Entry;
  wit: CopySet;
  /** 삭제를 확정하면 눌렀던 카드가 통째로 사라진다 — 초점은 이리로 돌아간다 */
  fallbackRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(boxRef, fallbackRef);

  // 기본 초점은 취소 — 열리자마자 누른 Enter가 곧바로 삭제로 이어지면 안 된다
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const d = new Date(entry.day + 'T12:00:00');
  const firstLine = (entry.memo || entry.body).trim().split('\n')[0] ?? '';
  const excerpt = firstLine || (entry.todos.length ? `할 일 ${entry.todos.length}개` : '(내용 없음)');

  return (
    <div className="overlay confirm-overlay" onClick={onCancel}>
      <div className="confirm" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="confirm-title" id={titleId}>{wit.delAsk}</div>
        <div className="confirm-card">
          <div className="confirm-card-head">
            <Chip tag={entry.tag} variant="sm2" />
            <span className="confirm-card-when">
              {d.getMonth() + 1}월 {d.getDate()}일 ({W[d.getDay()]}) {entry.time}
            </span>
          </div>
          <div className="confirm-card-excerpt">{excerpt}</div>
        </div>
        <div className="confirm-note">{wit.delNote}</div>
        <div className="confirm-btns">
          <button className="confirm-btn cancel" ref={cancelRef} onClick={onCancel}>취소</button>
          <button className="confirm-btn danger" onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  );
}
