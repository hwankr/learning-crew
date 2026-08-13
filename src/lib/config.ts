import { MEMBER_IDS, type MemberId } from '../../shared/types';
import { MEMBERS } from './constants';

export interface AppConfig {
  token: string | null;
  memberId: MemberId;
  initialView: 'feed' | 'cal' | 'noti';
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

  // 캘린더 중심 개편 — 기본 뷰가 캘린더다 (?view=feed로 피드, ?view=noti로 알림 —
  // 알림 푸시를 누르면 이 파라미터로 알림 내역이 바로 열린다)
  const viewParam = params.get('view');
  const initialView =
    viewParam === 'feed' || viewParam === '피드'
      ? 'feed'
      : viewParam === 'noti' || viewParam === '알림' || viewParam === 'notiset'
        ? 'noti'
        : 'cal';
  const initialNotiSettings = viewParam === 'notiset';

  if (tokenMember && token) {
    return { token, memberId: tokenMember, initialView, initialNotiSettings, demo: false, needsLogin: false };
  }
  // 데모 모드 — ?user=이름 으로 명시했을 때만 (동기화 없이 시드 데이터로 동작)
  const demoMember = MEMBERS.find((m) => m.name === params.get('user'));
  if (demoMember) {
    return { token: null, memberId: demoMember.id, initialView, initialNotiSettings, demo: true, needsLogin: false };
  }
  return { token: null, memberId: MEMBERS[0]!.id, initialView, initialNotiSettings, demo: false, needsLogin: true };
}
