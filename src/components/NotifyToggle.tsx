/* 기기 알림 토글 — 이 기기의 웹 푸시 구독을 켜고 끈다. 알림 설정 페이지에 산다. */
import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, initialPushState, type PushState } from '../lib/push';
import { BELL_D } from './icons';

function Bell({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flex: 'none' }}>
      <path d={BELL_D} />
    </svg>
  );
}

export function NotifyToggle({ token }: { token: string }) {
  // 동기로 아는 상태는 처음부터 — loading 자리 줄을 세웠다 걷으면 그게 또 레이아웃 점프다
  const [state, setState] = useState<PushState | 'loading'>(initialPushState);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  if (state === 'unsupported') return null;
  if (state === 'loading') {
    // 높이만 미리 잡아 두는 투명한 줄 — 판정이 끝나고 진짜 줄이 설 때 아래가 밀리지 않는다
    return (
      <div className="notify-row ph" aria-hidden="true">
        <Bell size={14} />
        <span className="notify-label">이 기기로 알림 받기</span>
        <button className="notify-btn" tabIndex={-1}>켜기</button>
      </div>
    );
  }

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setState(state === 'on' ? await disablePush(token) : await enablePush(token));
    } catch {
      setState(await getPushState()); // 실패하면 실제 상태로 되돌린다
    } finally {
      setBusy(false);
    }
  };

  if (state === 'ios-install') {
    return (
      <div className="notify-row hint">
        <Bell size={14} />
        <span>아이폰은 공유 → 홈 화면에 추가 후 알림을 켤 수 있어요</span>
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <div className="notify-row hint">
        <Bell size={14} />
        <span>알림이 브라우저에서 차단되어 있어요 — 사이트 설정에서 허용해 주세요</span>
      </div>
    );
  }
  return (
    <div className="notify-row">
      <Bell size={14} />
      <span className="notify-label">
        {state === 'on' ? '이 기기로 알림 받는 중' : '이 기기로 알림 받기'}
      </span>
      <button className={'notify-btn' + (state === 'on' ? ' on' : '')} onClick={() => void toggle()}
        disabled={busy}>
        {state === 'on' ? '끄기' : '켜기'}
      </button>
    </div>
  );
}
