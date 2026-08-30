import { MEMBER_IDS, type MemberId } from '../../shared/types';
import { MEMBERS } from './constants';

export interface AppConfig {
  token: string | null;
  memberId: MemberId;
  initialView: 'feed' | 'cal' | 'stats' | 'noti';
  /** ?view=로 화면을 지정받았는지 — 지정이 있으면 저장된(마지막으로 보던) 탭을 덮는다 */
  viewFromUrl: boolean;
  /** 옛 ?view=lounge 링크 — 피드로 접는 것만으로는 부족하다: 저장된 필터가 '기록'이면
      글과 입구가 다 숨어 링크의 뜻이 죽는다. 이 플래그가 라운지 갈래를 명시적으로 연다. */
  loungeFromUrl: boolean;
  /** ?view=notiset — 알림 설정 화면으로 바로 (알림 뷰의 하위 화면) */
  initialNotiSettings: boolean;
  demo: boolean;
  /** 토큰도 없고 데모(?user=)도 아니면 이름 선택 화면을 보여준다. */
  needsLogin: boolean;
}

const TOKEN_KEY = 'lc-token';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** 401(토큰 만료·서명 키 교체) 시 재로그인을 위해 — 로컬 기록(IndexedDB)은 그대로 남는다. */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function memberIdFromToken(token: string): MemberId | null {
  const head = token.split('.')[0];
  if (!head) return null;
  try {
    const id = atob(head.replaceAll('-', '+').replaceAll('_', '/'));
    return (MEMBER_IDS as readonly string[]).includes(id) ? (id as MemberId) : null;
  } catch {
    return null;
  }
}

/** ?view= 해석 — 모르는 값은 null(파라미터가 없는 것과 같게 둔다: 오타 하나가
    마지막으로 보던 탭을 조용히 캘린더로 되돌리면 안 된다). */
export function parseViewParam(
  v: string | null,
): { view: AppConfig['initialView'] | null; lounge: boolean } {
  if (v === 'feed' || v === '피드') return { view: 'feed', lounge: false };
  // 라운지는 피드 안의 갈래다 — 옛 딥링크는 피드로 보내되 라운지 갈래를 연다는 뜻을 남긴다
  if (v === 'lounge' || v === '라운지') return { view: 'feed', lounge: true };
  if (v === 'cal' || v === '캘린더') return { view: 'cal', lounge: false };
  if (v === 'stats' || v === '통계') return { view: 'stats', lounge: false };
  if (v === 'noti' || v === '알림' || v === 'notiset') return { view: 'noti', lounge: false };
  return { view: null, lounge: false };
}

/** URL 파라미터(?invite= / ?view= / 데모용 ?user=)와 저장된 토큰으로 앱 설정을 만든다. */
export function loadConfig(): AppConfig {
  const params = new URLSearchParams(location.search);

  const invite = params.get('invite');
  if (invite && memberIdFromToken(invite)) {
    saveToken(invite);
    params.delete('invite');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  const token = localStorage.getItem(TOKEN_KEY);
  const tokenMember = token ? memberIdFromToken(token) : null;

  // 파라미터가 없으면 저장된 탭이 이기고, 그것도 없으면 캘린더다 (?view=feed로 피드,
  // ?view=noti로 알림 — 알림 푸시를 누르면 이 파라미터로 알림 내역이 바로 열린다)
  const viewParam = params.get('view');
  const parsed = parseViewParam(viewParam);
  const initialView = parsed.view ?? 'cal';
  const viewFromUrl = parsed.view !== null;
  const loungeFromUrl = parsed.lounge;
  const initialNotiSettings = viewParam === 'notiset';

  if (tokenMember && token) {
    return { token, memberId: tokenMember, initialView, viewFromUrl, loungeFromUrl, initialNotiSettings, demo: false, needsLogin: false };
  }
  // 데모 모드 — ?user=이름 으로 명시했을 때만 (동기화 없이 시드 데이터로 동작)
  const demoMember = MEMBERS.find((m) => m.name === params.get('user'));
  if (demoMember) {
    return { token: null, memberId: demoMember.id, initialView, viewFromUrl, loungeFromUrl, initialNotiSettings, demo: true, needsLogin: false };
  }
  return { token: null, memberId: MEMBERS[0]!.id, initialView, viewFromUrl, loungeFromUrl, initialNotiSettings, demo: false, needsLogin: true };
}
