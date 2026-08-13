/* 동기화 상태 표시 — "이 기기엔 저장됐는데 다른 기기엔 안 보이는" 상황을 보이게 한다.
   평소(모두 동기화됨)에는 아주 옅게, 대기/오프라인/오류는 또렷하게, 401은 재로그인 버튼과 함께. */
import type { SyncInfo } from '../local/store';
import { clearToken } from '../lib/config';

function relogin(): void {
  clearToken();
  location.reload();
}

export function SyncStatus({ sync }: { sync: SyncInfo }) {
  if (sync.phase === 'auth') {
    return (
      <div className="sync-row warn">
        <span className="sync-dot warn" />
        <span className="sync-label">로그인이 풀렸어요 — 기록은 이 기기에 남아 있어요</span>
        <button className="sync-btn" onClick={relogin}>다시 로그인</button>
      </div>
    );
  }

  const n = sync.pending;
  let cls = 'ok';
  let text = '모두 동기화됨';
  if (sync.phase === 'offline') {
    cls = 'warn';
    text = n > 0 ? `오프라인 — 복귀하면 ${n}개 자동 전송` : '오프라인 — 기록은 이 기기에 저장돼요';
  } else if (sync.phase === 'error') {
    cls = 'warn';
    text = '서버 연결 오류 — 자동으로 재시도해요' + (n > 0 ? ` (대기 ${n}개)` : '');
  } else if (n > 0) {
    // '동기화 중'은 별도 국면이 아니라 대기 건수에서 파생된다
    cls = 'busy';
    text = `동기화 중 — 대기 ${n}개`;
  }
  return (
    <div className={'sync-row ' + cls}>
      <span className={'sync-dot ' + cls} />
      <span className="sync-label">{text}</span>
    </div>
  );
}
