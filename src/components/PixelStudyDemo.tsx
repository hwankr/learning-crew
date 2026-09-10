import { useEffect, useState } from 'react';
import { isStatusActive, type MemberId, type MemberStatus } from '../../shared/types';
import { MEMBERS, fmtElapsed } from '../lib/constants';
import { PixelPortrait } from './PixelCharacter';
import { PixelStudyRoom } from './PixelStudyRoom';
import { Wordmark } from './icons';
import './pixel-study-demo.css';

type DemoStatuses = Partial<Record<MemberId, MemberStatus>>;
function demoStatus(m: MemberId, on: boolean, now: number): MemberStatus {
  const at = new Date(now).toISOString();
  return { m, on, place: on ? '도서관' : null, since: on ? at : null, lastStartedAt: on ? at : null, updatedAt: at };
}
function initialStatuses(): DemoStatuses {
  const now = Date.now();
  return { wg: demoStatus('wg', true, now - 47 * 60_000), kj: demoStatus('kj', true, now - 18 * 60_000) };
}

/** A standalone, memory-only preview. Boot branches here before auth, storage, SW or sync. */
export function PixelStudyDemo() {
  const [statuses, setStatuses] = useState<DemoStatuses>(initialStatuses);
  const [now, setNow] = useState(Date.now);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState('크루의 공부 버튼을 눌러 작은 변화를 만나보세요.');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timers = MEMBERS.map((m, index) => window.setTimeout(() => {
      const at = Date.now();
      setNow(at);
      setStatuses((current) => ({ ...current, [m.id]: demoStatus(m.id, true, at) }));
      setMessage(`${m.name} · 책을 챙겨 도서관으로 향해요.`);
    }, 800 + index * 1900));
    timers.push(window.setTimeout(() => {
      const at = Date.now();
      setNow(at);
      setStatuses((current) => ({ ...current, sh: demoStatus('sh', false, at) }));
      setMessage('승환이 공부를 마치고 정원에서 잠깐 쉬어가요.');
    }, 13_000));
    timers.push(window.setTimeout(() => {
      setPlaying(false);
      setMessage('이제 직접 크루의 공부를 시작하거나 마쳐보세요.');
    }, 18_000));
    return () => timers.forEach(window.clearTimeout);
  }, [playing]);

  const studying = MEMBERS.filter((m) => isStatusActive(statuses[m.id], now)).length;
  const setMember = (id: MemberId, on: boolean) => {
    setPlaying(false);
    const at = Date.now();
    setNow(at);
    setStatuses((current) => ({ ...current, [id]: demoStatus(id, on, at) }));
    const name = MEMBERS.find((m) => m.id === id)!.name;
    setMessage(on ? `${name} · 책을 챙겨 도서관으로 향해요.` : `${name} · 공부를 마치고 정원으로 돌아가요.`);
  };
  const setEveryone = (on: boolean) => {
    setPlaying(false);
    const at = Date.now();
    setNow(at);
    setStatuses((current) => Object.fromEntries(MEMBERS.map((m) => [m.id,
      on && isStatusActive(current[m.id], at) ? current[m.id] : demoStatus(m.id, on, at),
    ])));
    setMessage(on ? '하나둘 모이면, 오늘도 든든한 공부 친구들.' : '오늘도 수고했어요. 잠깐 함께 쉬어가요.');
  };

  return (
    <div className="pixel-demo">
      <header className="pixel-demo-nav">
        <Wordmark />
        <span className="pixel-demo-preview">PIXEL PREVIEW <span>01</span></span>
      </header>
      <main className="pixel-demo-main">
        <div className="pixel-demo-intro">
          <div>
            <p className="pixel-demo-eyebrow">OUR LITTLE STUDY CLUB</p>
            <h1>각자의 자리에서,<br /><span>함께 공부하는 중.</span></h1>
            <p className="pixel-demo-description">공부를 시작하면 작은 내가 도서관으로 향해요.<br />친구의 옆자리에서, 오늘의 한 페이지를 채워봐요.</p>
          </div>
          <button type="button" className={'pixel-demo-play' + (playing ? ' playing' : '')}
            aria-pressed={playing} onClick={() => {
              if (playing) {
                setPlaying(false);
                setMessage('자동 시연을 멈췄어요. 버튼으로 계속 바꿔볼 수 있어요.');
              } else {
                setStatuses({});
                setMessage('잠시 후 크루가 하나둘 도서관에 모여요.');
                setPlaying(true);
              }
            }}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="m5 3 7 5-7 5z" fill="currentColor" />}
            </svg>
            {playing ? '시연 멈추기' : '자동 시연'}
          </button>
        </div>
        <div className="pixel-demo-layout">
          <div className="pixel-demo-scene">
            <PixelStudyRoom statuses={statuses} now={now} />
            <div className="pixel-demo-caption" role="status" aria-live="polite">
              <span aria-hidden="true">↳</span> {message}
            </div>
          </div>
          <aside className="pixel-demo-controls" aria-label="크루 공부 상태 시연">
            <div className="pixel-demo-crew-head"><h2>오늘의 크루</h2><span>{String(MEMBERS.length).padStart(2, '0')} MEMBERS</span></div>
            <p className="pixel-demo-crew-sub">작은 시작도, 함께하면 힘이 되니까.</p>
            <div className="pixel-demo-members">
              {MEMBERS.map((m) => {
                const status = statuses[m.id];
                const active = isStatusActive(status, now);
                return (
                  <div key={m.id} className={'pixel-demo-member' + (active ? ' studying' : '')}>
                    <span className="pixel-demo-avatar" style={{ background: m.soft }}><PixelPortrait m={m} /></span>
                    <div className="pixel-demo-member-text"><strong>{m.name}</strong>
                      <span>{active && status.since ? fmtElapsed(status.since, now) : '잠깐 쉬는 중'}</span>
                    </div>
                    <button type="button" className="pixel-demo-checkin" aria-pressed={active}
                      aria-label={`${m.name} ${active ? '공부 종료' : '도서관에서 공부 시작'}`}
                      onClick={() => setMember(m.id, !active)}>{active ? '공부 종료' : '공부 시작'}</button>
                  </div>
                );
              })}
            </div>
            <div className="pixel-demo-bulk">
              <button type="button" disabled={studying === MEMBERS.length} onClick={() => setEveryone(true)}>모두 도서관으로 <span aria-hidden="true">↗</span></button>
              <button type="button" disabled={studying === 0} onClick={() => setEveryone(false)}>모두 쉬어가기 <span aria-hidden="true">☁</span></button>
            </div>
            <div className="pixel-demo-note"><span aria-hidden="true">✳</span><p>마음껏 눌러보세요.<br />시연은 실제 공부 기록에 반영되지 않아요.</p></div>
          </aside>
        </div>
        <footer className="pixel-demo-footer"><span>조금씩, 꾸준히, 함께.</span><span>LEARNING CREW · LITTLE MOMENTS, TOGETHER</span></footer>
      </main>
    </div>
  );
}
