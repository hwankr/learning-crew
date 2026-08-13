/* 알림 설정 페이지 — 디자인(알림 - 모바일.dc.html)의 설정 화면.
   설정은 서버(멤버당 1행)가 진실이다: 푸시를 쏘는 쪽이 Worker라 게이트도 서버에 있어야 한다.
   열 때 GET으로 읽고, 고칠 때마다 화면에 먼저 반영한 뒤 짧게 모아 PUT한다(낙관적).
   데모 모드는 서버가 없으니 메모리에서만 동작하고 그 사실을 화면에 밝힌다. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_NOTIF_PREFS,
  MEMBER_IDS,
  MEMBER_NAMES,
  type MemberId,
  type NotifMode,
  type NotifPrefs,
  type NotifPrefsResponse,
} from '../../shared/types';
import { authHeaders } from '../lib/push';
import { BY_ID } from '../lib/constants';
import { Avatar, BACK_D, Icon, LOCK_D } from './icons';
import { NotifyToggle } from './NotifyToggle';

type Draft = Omit<NotifPrefs, 'm' | 'updatedAt'>;

const MODES: { id: NotifMode; label: string; desc: string; badge?: boolean }[] = [
  { id: 'live', label: '시작할 때마다', desc: '타이머를 켤 때마다 바로. 함께 달리는 느낌이 필요할 때.' },
  { id: 'daily', label: '하루에 한 번만', desc: '크루별로 그날 첫 시작만. "오늘 도서관 갔네?" 정도로 가볍게.', badge: true },
  { id: 'off', label: '받지 않기', desc: '캘린더와 피드에서 직접 확인할게요.' },
];

const CM_ROWS = [
  { id: 'cmMine', label: '내 기록에 달린 댓글', desc: '누가 내 기록에 말을 걸었을 때' },
  { id: 'cmReply', label: '내 댓글에 달린 답글', desc: '시작한 대화가 이어질 때' },
  { id: 'cmAll', label: '크루 기록의 모든 댓글', desc: '조용히 지내려면 꺼두세요.' },
] as const;

const PER_OPTS: { id: NotifMode; label: string }[] = [
  { id: 'live', label: '실시간' },
  { id: 'daily', label: '하루 1회' },
  { id: 'off', label: '끔' },
];
const REACT_OPTS: { id: NotifMode; label: string }[] = [
  { id: 'live', label: '바로' },
  { id: 'daily', label: '하루 요약' },
  { id: 'off', label: '끔' },
];

// 방해 금지 시각 — 서버 검증(HH:00)과 다이제스트 cron이 시간 단위라 정각만 고른다
const FROMS = ['21:00', '22:00', '23:00', '00:00'];
const TOS = ['06:00', '07:00', '08:00', '09:00'];

const cycle = (list: string[], cur: string): string =>
  list[(Math.max(0, list.indexOf(cur)) + 1) % list.length]!;

/** 하루 예상 알림 수 — 디자인의 어림 공식 그대로. 정확한 예측이 아니라 감을 주는 숫자다. */
export function estimateDaily(p: Draft, me: MemberId): { start: number; cm: number; react: number } {
  const crew = MEMBER_IDS.filter((m) => m !== me);
  const start = crew.reduce((n, m) => {
    const r = p.perMember[m] ?? p.startMode;
    return n + (r === 'live' ? 3 : r === 'daily' ? 1 : 0);
  }, 0);
  const cm = (p.cmMine ? 3 : 0) + (p.cmReply ? 2 : 0) + (p.cmAll ? 12 : 0) + 1;
  const react = p.reactMode === 'live' ? 5 : p.reactMode === 'daily' ? 1 : 0;
  return { start, cm, react };
}

function Seg({ opts, cur, onPick }: {
  opts: { id: NotifMode; label: string }[];
  cur: NotifMode;
  onPick: (v: NotifMode) => void;
}) {
  return (
    <div className="nseg" role="radiogroup">
      {opts.map((o) => (
        <button key={o.id} className={'nseg-btn' + (o.id === cur ? ' on' : '')}
          role="radio" aria-checked={o.id === cur} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button className={'nswitch' + (on ? ' on' : '')} role="switch" aria-checked={on}
      aria-label={label} onClick={onToggle}>
      <span className="nswitch-knob" />
    </button>
  );
}

interface Props {
  token: string | null;
  meId: MemberId;
  demo: boolean;
  onBack: () => void;
}

export function NotiSettings({ token, meId, demo, onBack }: Props) {
  const [prefs, setPrefs] = useState<Draft | null>(null);
  // 읽기 실패는 기본값으로 대체하지 않는다 — 기본값 화면에서 토글 하나만 바꿔도
  // "기본값+그 변경"이 통째로 PUT되어 서버의 기존 설정 전체를 덮는다. 재시도만 제공한다.
  const [loadErr, setLoadErr] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [saveErr, setSaveErr] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Draft | null>(null);
  // 저장은 직렬로 — 디바운스 PUT과 언마운트 플러시가 겹칠 때 응답 역전으로
  // 낡은 draft가 서버의 최종값이 되지 않게 한 줄로 세운다
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!token) {
      setPrefs({ ...DEFAULT_NOTIF_PREFS });
      return;
    }
    let alive = true;
    setLoadErr(false);
    void fetch('/api/notify/prefs', { headers: authHeaders(token) })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as NotifPrefsResponse;
        const { m: _m, updatedAt: _u, ...rest } = data.prefs;
        if (alive) setPrefs(rest);
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, [token, loadTick]);

  const save = useCallback(
    (draft: Draft) => {
      if (!token) return; // 데모 — 메모리 전용
      saveChain.current = saveChain.current.then(() =>
        fetch('/api/notify/prefs', {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify(draft),
        })
          .then((res) => setSaveErr(!res.ok))
          .catch(() => setSaveErr(true)),
      );
    },
    [token],
  );

  // 언마운트 시 아직 안 보낸 변경을 즉시 보낸다 — 마지막 토글 유실 방지
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (latest.current) save(latest.current);
      }
    },
    [save],
  );

  const update = (patch: Partial<Draft>): void => {
    setPrefs((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      latest.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        save(next);
      }, 500);
      return next;
    });
  };

  if (!prefs) {
    return (
      <div className="noti-page">
        <div className="nset-back-row">
          <button className="icon-btn" aria-label="알림으로 돌아가기" onClick={onBack}>
            <Icon d={BACK_D} size={22} sw={2.4} />
          </button>
          <span className="nset-back-label">알림</span>
        </div>
        {loadErr ? (
          <div className="noti-empty">
            설정을 불러오지 못했어요.
            <div style={{ marginTop: 12 }}>
              <button className="nset-retry" onClick={() => setLoadTick((t) => t + 1)}>
                다시 시도
              </button>
            </div>
          </div>
        ) : (
          <div className="noti-empty">설정을 불러오는 중…</div>
        )}
      </div>
    );
  }

  const crew = MEMBER_IDS.filter((m) => m !== meId);
  const est = estimateDaily(prefs, meId);
  const quietNote = prefs.quietEnabled
    ? `${prefs.quietFrom}~${prefs.quietTo} 사이 알림은 모아서 ${prefs.quietTo}에 한 번 도착해요.`
    : '밤낮 없이 오는 대로 받아요.';

  return (
    <div className="noti-page">
      <div className="nset-back-row">
        <button className="icon-btn" aria-label="알림으로 돌아가기" onClick={onBack}>
          <Icon d={BACK_D} size={22} sw={2.4} />
        </button>
        <span className="nset-back-label">알림</span>
      </div>
      <div className="nset-title">알림 설정</div>
      {demo && <div className="demo-note nset-demo">데모 모드 — 설정은 저장되지 않아요.</div>}
      {saveErr && (
        <div className="nset-error">
          저장하지 못했어요.
          <button className="nset-retry" onClick={() => latest.current && save(latest.current)}>
            다시 시도
          </button>
        </div>
      )}

      {token && (
        <div className="nset-card nset-device">
          <NotifyToggle token={token} />
        </div>
      )}

      <div className="nset-label">공부 시작</div>
      <div className="nset-modes" role="radiogroup" aria-label="공부 시작 알림">
        {MODES.map((m) => {
          const sel = m.id === prefs.startMode;
          return (
            <button key={m.id} className={'nset-mode' + (sel ? ' sel' : '')} role="radio"
              aria-checked={sel}
              onClick={() => update({ startMode: m.id, perMember: {} })}>
              <span className={'nset-radio' + (sel ? ' sel' : '')} />
              <span className="nset-mode-main">
                <span className="nset-mode-head">
                  <span className="nset-mode-title">{m.label}</span>
                  {m.badge && <span className="nset-badge">추천</span>}
                </span>
                <span className="nset-mode-desc">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="nset-label">크루별로 다르게</div>
      <div className="nset-crew-list">
        {crew.map((m) => {
          const resolved = prefs.perMember[m] ?? prefs.startMode;
          const hint =
            resolved === 'live' ? '켤 때마다 알림' : resolved === 'daily' ? '그날 첫 시작만' : '이 크루는 알림 없음';
          return (
            <div key={m} className="nset-card">
              <div className="nset-crew-head">
                <Avatar m={BY_ID[m]} size={36} />
                <span className="nset-crew-main">
                  <span className="nset-crew-name">{MEMBER_NAMES[m]}</span>
                  <span className="nset-crew-hint">{hint}</span>
                </span>
              </div>
              <Seg opts={PER_OPTS} cur={resolved}
                onPick={(v) => update({ perMember: { ...prefs.perMember, [m]: v } })} />
            </div>
          );
        })}
      </div>

      <div className="nset-label">댓글과 반응</div>
      <div className="nset-card nset-cm">
        {CM_ROWS.map((c) => (
          <div key={c.id} className="nset-cm-row">
            <span className="nset-cm-main">
              <span className="nset-cm-title">{c.label}</span>
              <span className="nset-cm-desc">{c.desc}</span>
            </span>
            <Switch on={prefs[c.id]} label={c.label} onToggle={() => update({ [c.id]: !prefs[c.id] })} />
          </div>
        ))}
        <div className="nset-cm-row">
          <span className="nset-cm-main">
            <span className="nset-cm-title nset-locked">
              나를 언급한 댓글
              <Icon d={LOCK_D} size={11} sw={2.2} />
            </span>
            <span className="nset-cm-desc">{`@${MEMBER_NAMES[meId]} 이 들어간 댓글은 설정과 상관없이 받아요.`}</span>
          </span>
          <span className="nset-always">항상</span>
        </div>
        <div className="nset-cm-row col">
          <span className="nset-cm-main">
            <span className="nset-cm-title">응원 반응</span>
            <span className="nset-cm-desc">모아서 받을 수 있어요.</span>
          </span>
          <Seg opts={REACT_OPTS} cur={prefs.reactMode} onPick={(v) => update({ reactMode: v })} />
        </div>
      </div>

      <div className="nset-label">방해 금지 시간</div>
      <div className="nset-card">
        <div className="nset-quiet-head">
          <span className="nset-cm-title">이 시간엔 조용히</span>
          <Switch on={prefs.quietEnabled} label="방해 금지 시간"
            onToggle={() => update({ quietEnabled: !prefs.quietEnabled })} />
        </div>
        <div className="nset-quiet-times" style={{ opacity: prefs.quietEnabled ? 1 : 0.4 }}>
          <button className="nset-time" disabled={!prefs.quietEnabled}
            onClick={() => update({ quietFrom: cycle(FROMS, prefs.quietFrom) })}>
            {prefs.quietFrom}
          </button>
          <span className="nset-time-word">부터</span>
          <button className="nset-time" disabled={!prefs.quietEnabled}
            onClick={() => update({ quietTo: cycle(TOS, prefs.quietTo) })}>
            {prefs.quietTo}
          </button>
          <span className="nset-time-word">까지</span>
        </div>
        <div className="nset-quiet-note">{quietNote}</div>
      </div>
    </div>
  );
}
