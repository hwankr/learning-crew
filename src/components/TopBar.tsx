/* 데스크톱 상단 바 — 이동(탭)·작성·동기화·알림을 한 줄에 모은다.
   예전 브랜드 줄에 쌓여 있던 아바타 스택·CTA·상태 줄이 전부 이 한 줄로 들어왔다.
   <900px에서는 줄바꿈으로 버티기만 한다(하단 탭바 셸은 별도 파트). */
import type { RefObject } from 'react';
import type { SyncInfo } from '../local/store';
import type { CopySet, Member } from '../lib/constants';
import { Avatar, BELL_D, Icon, PENCIL_D } from './icons';
import { SyncStatus } from './SyncStatus';

/* 화살표는 "누르면 어느 쪽으로 움직이나"를 가리킨다 — 접혀 있으면 오른쪽(열림), 펴져 있으면 왼쪽. */
const PANEL_SHUT_D = 'M9 5l7 7-7 7';
const PANEL_OPEN_D = 'M15 5l-7 7 7 7';

export function TopBar({
  me, wit, view, onView, panelOpen, onTogglePanel, sync, unread, notiOn, onBell, onCompose, composeRef,
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
  onCompose: () => void;
  /** 모달이 닫힐 때 초점이 돌아올 자리 — 이 버튼이 모달을 여는 유일한 입구다 */
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
        {/* 이 자리를 기준으로 알림 드롭다운이 뜬다(별도 파트) — 지금은 벨만 산다 */}
        <div className="bell-wrap">
          <button className={'bell-btn' + (notiOn ? ' on' : '')}
            aria-label={unread > 0 ? `알림 — 안 읽음 ${unread}개` : '알림'}
            onClick={onBell}>
            <Icon d={BELL_D} size={19} sw={2} />
            {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>
        <span className="top-av">
          <Avatar m={me} size={34} />
        </span>
      </div>
    </header>
  );
}
