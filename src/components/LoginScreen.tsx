import { useState } from 'react';
import { MEMBERS } from '../lib/constants';
import { Avatar } from './icons';
import { saveToken } from '../lib/config';

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
      <div className="login-grid">
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
