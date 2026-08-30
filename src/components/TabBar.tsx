/* 좁은 화면 하단 탭바 — 상단 바가 없는 모바일 셸에서 이동을 전담한다.
   화면 밖으로 스크롤되면 긴 피드 한가운데서 갈 곳이 없어지므로 고정으로 띄운다. */
import type { RefObject } from 'react';
import type { MobileTab } from '../lib/uiState';
import { Exit } from '../lib/exit';
import { BELL_D, Icon } from './icons';

const TABS: { id: MobileTab; label: string; d: string }[] = [
  { id: 'home', label: '홈', d: 'M3 10.5 12 3.5l9 7M5.5 9.2V20h13V9.2' },
  { id: 'feed', label: '피드', d: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'cal', label: '캘린더', d: 'M4.5 5.5h15v15h-15zM4.5 10h15M9 3.5v4M15 3.5v4' },
  { id: 'stats', label: '통계', d: 'M4 20v-7M9.3 20V6M14.6 20v-4M20 20V10' },
  { id: 'alerts', label: '알림', d: BELL_D },
];

export function TabBar({
  tab, onTab, unread, anchorRef,
}: {
  tab: MobileTab;
  onTab: (t: MobileTab) => void;
  unread: number;
  /** 떠 있는 기록 버튼이 없는 탭에서 모달·확인창이 닫힐 때 초점이 돌아올 자리 —
      없으면 초점이 문서 맨 앞으로 떨어진다(홈·피드에서는 그 버튼이 받는다). */
  anchorRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <nav className="tabbar" aria-label="화면 이동">
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button key={t.id} className={'tab' + (on ? ' on' : '')}
            ref={on ? anchorRef : undefined}
            aria-current={on ? 'page' : undefined}
            onClick={() => onTab(t.id)}>
            {/* 선택은 색만이 아니라 획 두께로도 갈린다 — 20px 아이콘에서 색 대비만으로는 약하다 */}
            <Icon d={t.d} size={20} sw={on ? 2.3 : 1.9} />
            <span className="tab-label-row">
              <span className="tab-label">{t.label}</span>
              {/* key=unread — 수가 바뀌면 배지가 새로 서며 팝, 다 읽으면 Exit가 줄어들며 걷는다 */}
              {t.id === 'alerts' && (
                <Exit>{unread > 0 && (
                  // key는 보이는 글자 기준 — 10→11처럼 9+ 그대로면 팝도 없다
                  <span key={unread > 9 ? '9+' : unread} className="tab-badge"
                    aria-label={`안 읽음 ${unread}개`}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}</Exit>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
