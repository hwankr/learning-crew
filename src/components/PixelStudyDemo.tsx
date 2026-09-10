import { useCallback, useEffect, useState } from 'react';
import { isStatusActive, type MemberId, type MemberStatus } from '../../shared/types';
import { BY_ID, MEMBERS, fmtElapsed } from '../lib/constants';
import { ROOM_PERSONALITY } from '../lib/pixelRoom';
import { PixelPortrait } from './PixelCharacter';
import { PixelStudyRoom } from './PixelStudyRoom';
import { PixelCharacterGallery } from './PixelCharacterGallery';
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
  const [selectedId, setSelectedId] = useState<MemberId>('wg');
  const [message, setMessage] = useState('크루는 스스로 책을 고르고, 정원을 거닐고, 친구를 만나 이야기해요.');
  const [activityLog, setActivityLog] = useState<{ text: string; at: string }[]>([]);
  const announce = useCallback((text: string) => {
    setMessage(text);
    const at = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    setActivityLog((current) => [{ text, at }, ...current].slice(0, 3));
  }, []);

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
      setSelectedId(m.id);
      announce(`${m.name} · 책을 챙겨 도서관으로 향해요.`);
    }, 800 + index * 1900));
    timers.push(window.setTimeout(() => {
      const at = Date.now();
      setNow(at);
      setStatuses((current) => ({ ...current, sh: demoStatus('sh', false, at) }));
      setSelectedId('sh');
      announce('승환이 공부를 마치고 정원에서 잠깐 쉬어가요.');
    }, 13_000));
    timers.push(window.setTimeout(() => {
      setPlaying(false);
      setMessage('이제 직접 크루의 공부를 시작하거나 마쳐보세요.');
    }, 18_000));
    return () => timers.forEach(window.clearTimeout);
  }, [playing, announce]);

  const studying = MEMBERS.filter((m) => isStatusActive(statuses[m.id], now)).length;
  const selectedMember = BY_ID[selectedId];
  const selectedStatus = statuses[selectedId];
  const selectedActive = isStatusActive(selectedStatus, now);
  const setMember = (id: MemberId, on: boolean) => {
    setPlaying(false);
    const at = Date.now();
    setNow(at);
    setSelectedId(id);
    setStatuses((current) => ({ ...current, [id]: demoStatus(id, on, at) }));
    const name = MEMBERS.find((m) => m.id === id)!.name;
    announce(on ? `${name} · 책을 챙겨 도서관으로 향해요.` : `${name} · 공부를 마치고 정원으로 돌아가요.`);
  };
  const setEveryone = (on: boolean) => {
    setPlaying(false);
    const at = Date.now();
    setNow(at);
    setStatuses((current) => Object.fromEntries(MEMBERS.map((m) => [m.id,
      on && isStatusActive(current[m.id], at) ? current[m.id] : demoStatus(m.id, on, at),
    ])));
    announce(on ? '하나둘 모이면, 오늘도 든든한 공부 친구들.' : '오늘도 수고했어요. 잠깐 함께 쉬어가요.');
  };

  return (
    <div className="pixel-demo">
      <header className="pixel-demo-nav">
        <div className="pixel-demo-brand"><Wordmark /><span>우리의 작은 캠퍼스</span></div>
        <span className="pixel-demo-preview"><span className="pixel-demo-preview-dot" />시연 모드</span>
      </header>
      <main className="pixel-demo-main">
        <div className="pixel-demo-intro">
          <div>
            <p className="pixel-demo-eyebrow">A LITTLE WORLD, A SHARED DAY</p>
            <h1>오늘도, <span>같은 공간에서.</span></h1>
            <p className="pixel-demo-description">도서관에서 카페로, 정원에서 다시 책상으로. 저마다의 하루가 흐르는 곳.</p>
          </div>
          <button type="button" className={'pixel-demo-play' + (playing ? ' playing' : '')}
            aria-pressed={playing} onClick={() => {
              if (playing) {
                setPlaying(false);
                setMessage('체크인 시연을 멈췄어요. 크루의 작은 하루는 계속돼요.');
              } else {
                setStatuses({});
                setActivityLog([]);
                setMessage('잠시 후 크루가 하나둘 도서관에 모여요.');
                setPlaying(true);
              }
            }}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="m5 3 7 5-7 5z" fill="currentColor" />}
            </svg>
            {playing ? '체크인 시연 멈추기' : '체크인 시연'}
          </button>
        </div>
        <div className="pixel-demo-layout">
          <div className="pixel-demo-scene">
            <div className="pixel-demo-quick" role="group" aria-label="선택한 크루 체크인">
              <span className="pixel-demo-avatar" style={{ background: selectedMember.soft }}><PixelPortrait m={selectedMember} /></span>
              <div className="pixel-demo-quick-copy">
                <select aria-label="체크인할 크루" value={selectedId} onChange={(event) => setSelectedId(event.target.value as MemberId)}>
                  {MEMBERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <span>{selectedActive && selectedStatus.since ? `도서관 · ${fmtElapsed(selectedStatus.since, now)}` : '캠퍼스에서 쉬는 중'}</span>
              </div>
              <button type="button" className="pixel-demo-checkin" aria-pressed={selectedActive}
                aria-label={`선택한 ${selectedMember.name} ${selectedActive ? '공부 종료' : '도서관에서 공부 시작'}`}
                onClick={() => setMember(selectedId, !selectedActive)}>{selectedActive ? '공부 종료' : '공부 시작'}</button>
            </div>
            <PixelStudyRoom statuses={statuses} now={now} selectedId={selectedId} onSelectMember={setSelectedId} />
            <div className="pixel-demo-caption" role="status" aria-live="polite">
              <span aria-hidden="true">↳</span> {message}
            </div>
          </div>
          <aside className="pixel-demo-controls" aria-label="크루 공부 상태 시연">
            <div className="pixel-demo-crew-head"><h2>함께하는 크루</h2><span>{studying}<span> / {MEMBERS.length}</span></span></div>
            <p className="pixel-demo-crew-sub"><span className="pixel-demo-online-dot" />{studying ? `${studying}명이 각자의 페이지를 채우고 있어요` : '시작을 기다리는 조용한 공간'}</p>
            <div className="pixel-demo-members">
              {MEMBERS.map((m) => {
                const status = statuses[m.id];
                const active = isStatusActive(status, now);
                return (
                  <div key={m.id} className={'pixel-demo-member' + (active ? ' studying' : '') + (selectedId === m.id ? ' selected' : '')}>
                    <button type="button" className="pixel-demo-select" aria-label={`${m.name} 캐릭터 보기`} aria-pressed={selectedId === m.id} onClick={() => setSelectedId(m.id)}>
                      <span className="pixel-demo-avatar" style={{ background: m.soft }}><PixelPortrait m={m} />{active && <span className="pixel-demo-avatar-dot" />}</span>
                      <span className="pixel-demo-member-text"><strong>{m.name}<span>{active ? { read: '독서', write: '필기', type: '타이핑' }[ROOM_PERSONALITY[m.id].study] : '휴식'}</span></strong>
                        <span>{active && status.since ? fmtElapsed(status.since, now) : '캠퍼스에서 쉬어가기'}</span>
                      </span>
                    </button>
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
            <div className="pixel-demo-journal">
              <h3><span aria-hidden="true">⌁</span> 체크인 소식</h3>
              {activityLog.length ? <ol>{activityLog.map((event, i) => <li key={`${event.at}-${i}`}><span>{event.text}</span><time>{event.at}</time></li>)}</ol>
                : <p>누군가 자리에 앉으면,<br />우리의 이야기도 한 줄씩 쌓여요.</p>}
            </div>
            <div className="pixel-demo-note"><span aria-hidden="true">✳</span><p>시연은 실제 공부 기록에 반영되지 않아요. 캐릭터의 산책과 대화는 공간 속 연출이며, 공부 중 표시와 시간은 체크인 상태를 따라가요.</p></div>
          </aside>
        </div>
        <PixelCharacterGallery />
        <footer className="pixel-demo-footer"><span>잠깐 쉬어가도, 우리는 같은 곳에.</span><span>LEARNING CREW · MADE FOR OUR LITTLE EVERYDAY</span></footer>
      </main>
    </div>
  );
}
