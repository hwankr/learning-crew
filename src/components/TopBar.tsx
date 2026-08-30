/* 데스크톱 상단 바 — 이동(탭)·작성·동기화·알림을 한 줄에 모은다.
   예전 브랜드 줄에 쌓여 있던 아바타 스택·CTA·상태 줄이 전부 이 한 줄로 들어왔다.
   ≥900px에서만 선다 — 좁은 화면은 하단 탭바(TabBar)가 이 역할을 통째로 대신한다. */
import type { ReactNode, RefObject } from 'react';
import type { SyncInfo } from '../local/store';
import type { CopySet, Member } from '../lib/constants';
import type { DesktopView } from '../lib/uiState';
import { Exit } from '../lib/exit';
import { Avatar, BELL_D, Icon, PENCIL_D, Wordmark } from './icons';
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
  view: DesktopView;
  onView: (v: DesktopView) => void;
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
        {/* 로고가 곧 홈 버튼 — 어디에 있든(캘린더·알림 설정) 피드로 돌아온다.
            onView가 알림 드롭다운·설정 닫기까지 맡고 있어 그대로 태운다. */}
        <button className="wordmark" aria-label="홈으로" onClick={() => onView('feed')}>
          <Wordmark />
        </button>
        <div className="seg">
          <button className={'seg-btn' + (view === 'feed' ? ' on' : '')} data-label="피드"
            aria-pressed={view === 'feed'} onClick={() => onView('feed')}>
            <span>피드</span>
          </button>
          <button className={'seg-btn' + (view === 'cal' ? ' on' : '')} data-label="캘린더"
            aria-pressed={view === 'cal'} onClick={() => onView('cal')}>
            <span>캘린더</span>
          </button>
          <button className={'seg-btn' + (view === 'stats' ? ' on' : '')} data-label="통계"
            aria-pressed={view === 'stats'} onClick={() => onView('stats')}>
            <span>통계</span>
          </button>
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
            <Exit>{unread > 0 && (
              <span key={unread > 9 ? '9+' : unread} className="bell-badge">
                {unread > 9 ? '9+' : unread}
              </span>
            )}</Exit>
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
