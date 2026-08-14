/* 데스크톱 상단 바 — 이동(탭)·작성·동기화·알림을 한 줄에 모은다.
   예전 브랜드 줄에 쌓여 있던 아바타 스택·CTA·상태 줄이 전부 이 한 줄로 들어왔다.
   ≥900px에서만 선다 — 좁은 화면은 하단 탭바(TabBar)가 이 역할을 통째로 대신한다. */
import type { ReactNode, RefObject } from 'react';
import type { SyncInfo } from '../local/store';
import type { CopySet, Member } from '../lib/constants';
import { Avatar, BELL_D, Icon, PENCIL_D } from './icons';
import { SyncStatus } from './SyncStatus';

/* 화살표는 "누르면 어느 쪽으로 움직이나"를 가리킨다 — 접혀 있으면 오른쪽(열림), 펴져 있으면 왼쪽. */
const PANEL_SHUT_D = 'M9 5l7 7-7 7';
const PANEL_OPEN_D = 'M15 5l-7 7 7 7';

export function TopBar({
  me, wit, view, onView, panelOpen, onTogglePanel, sync, unread, notiOn, onBell, bellRef,
  dropdown, onCompose, composeRef,
}: {
  me: Member;
  wit: CopySet;
  view: 'feed' | 'cal';
  onView: (v: 'feed' | 'cal') => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** null이면 이 줄에 아무것도 세우지 않는다 — 데모(토큰 없음)에는 맞출 서버가 없다 */
  sync: SyncInfo | null;
  unread: number;
  notiOn: boolean;
  onBell: () => void;
  bellRef: RefObject<HTMLButtonElement | null>;
  /** 데스크톱 알림 드롭다운 — 열려 있을 때만 온다 */
  dropdown: ReactNode;
  onCompose: () => void;
  /** 카드가 사라진 뒤에도 모달·확인창의 초점이 돌아올 수 있는 전역 버튼 */
  composeRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className={'panel-btn' + (panelOpen ? ' on' : '')} onClick={onTogglePanel}
          aria-expanded={panelOpen} aria-label="크루 패널">
          <Icon d={panelOpen ? PANEL_OPEN_D : PANEL_SHUT_D} size={15} sw={2.4} />
          <span>크루</span>
        </button>
        <div className="wordmark">러닝 크루 👟</div>
        <div className="seg">
          <button className={'seg-btn' + (view === 'feed' ? ' on' : '')} aria-pressed={view === 'feed'}
            onClick={() => onView('feed')}>피드</button>
          <button className={'seg-btn' + (view === 'cal' ? ' on' : '')} aria-pressed={view === 'cal'}
            onClick={() => onView('cal')}>캘린더</button>
        </div>
        <div className="top-gap" />
        {sync && <SyncStatus sync={sync} variant="top" />}
        <button className="top-cta" ref={composeRef} onClick={onCompose}>
          <Icon d={PENCIL_D} size={15} sw={2.2} />
          <span>{wit.cta}</span>
        </button>
        {/* 드롭다운은 이 래퍼를 기준으로 뜬다(벨이 아니라) — 벨에 붙이면 38px 버튼
            안쪽으로 352px 상자의 위치를 잡게 된다 */}
        <div className="bell-wrap">
          <button className={'bell-btn' + (notiOn ? ' on' : '')} ref={bellRef}
            aria-label={unread > 0 ? `알림 — 안 읽음 ${unread}개` : '알림'}
            aria-haspopup="dialog" aria-expanded={notiOn}
            onClick={onBell}>
            <Icon d={BELL_D} size={19} sw={2} />
            {/* 열려 있어도 배지는 남는다 — 안 읽은 수는 드롭다운을 여는 것과 무관하다 */}
            {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {dropdown}
        </div>
        <span className="top-av">
          <Avatar m={me} size={34} />
        </span>
      </div>
    </header>
  );
}
