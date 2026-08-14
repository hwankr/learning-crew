/* 좁은 화면의 떠 있는 기록 버튼 — 상단 바 CTA가 사라진 자리를 대신한다.
   오늘 이미 남겼으면 무지개 테두리로 바뀌지만 눌리는 것은 그대로다(추가 기록). */
import type { RefObject } from 'react';
import type { CopySet } from '../lib/constants';
import { Icon, PENCIL_D } from './icons';

export function Fab({
  done, wit, onClick, btnRef,
}: {
  /** 오늘 내 기록이 있는가 — 남길 일이 남았는지가 버튼의 표정을 정한다 */
  done: boolean;
  wit: CopySet;
  onClick: () => void;
  btnRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    // 그라디언트 테두리는 흰 알약을 감싼 2px 바깥 레이어다 — border로는 그라디언트를 못 준다
    <div className={'fab' + (done ? ' done' : '')}>
      <button className="fab-btn" ref={btnRef} onClick={onClick}>
        <span className="fab-ico">
          {done ? '✨' : <Icon d={PENCIL_D} size={15} sw={2.4} />}
        </span>
        <span className="fab-label">{done ? wit.ctaDone : wit.cta}</span>
      </button>
    </div>
  );
}
