import { useState } from 'react';
import type { CSSProperties } from 'react';
import { MEMBERS } from '../lib/constants';
import { Avatar } from './icons';
import { saveToken } from '../lib/config';

/** 이름 카드의 열 수 — 정사각형에 가깝게 잡는다(4명 2열, 5·6명 3열, 7~9명 3열).
    2열 고정이면 5명일 때 마지막 한 장이 왼쪽에 홀로 남아 "덜 그려진 화면"처럼 보인다.
    한 줄에 4장을 넘기면 좁은 폰에서 카드가 아바타보다 좁아지므로 4열에서 멈춘다. */
function loginCols(n: number): number {
  return Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
}

export function LoginScreen() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const claim = async (memberId: string) => {
    setBusy(memberId);
    setError(false);
    try {
      const res = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ m: memberId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { token } = (await res.json()) as { token: string };
      saveToken(token);
      location.reload();
    } catch {
      setError(true);
      setBusy(null);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-brand">러닝 크루 👟</div>
      <div className="login-sub">누구세요? 이름을 고르면 시작돼요</div>
      <div className="login-grid" style={{ '--cols': loginCols(MEMBERS.length) } as CSSProperties}>
        {MEMBERS.map((m) => (
          <button key={m.id} className="login-card" disabled={busy !== null} onClick={() => void claim(m.id)}>
            <Avatar m={m} size={52} opacity={busy && busy !== m.id ? 0.4 : undefined} />
            <span className="login-name">{m.name}</span>
          </button>
        ))}
      </div>
      {error && <div className="login-error">연결에 실패했어요. 잠시 후 다시 눌러주세요.</div>}
    </div>
  );
}
