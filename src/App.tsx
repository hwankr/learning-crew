import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Entry } from '../shared/types';
import { BY_ID, COPY, MEMBERS, W, dayKey, pad2, shiftKey } from './lib/constants';
import type { AppConfig } from './lib/config';
import type { CrewStore } from './local/store';
import { Avatar, Icon, PENCIL_D } from './components/icons';
import { Board } from './components/Board';
import { StatusBar } from './components/StatusBar';
import { NotifyToggle } from './components/NotifyToggle';
import { SyncStatus } from './components/SyncStatus';
import { Feed } from './components/Feed';
import { CalendarView } from './components/CalendarView';
import { EMPTY_MODAL, EntryModal, type ModalState } from './components/EntryModal';

export function App({ cfg, store }: { cfg: AppConfig; store: CrewStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [view, setView] = useState<'feed' | 'cal'>(cfg.initialView);
  const [calOff, setCalOff] = useState(0);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);
  const patch = useCallback((p: Partial<ModalState>) => setModal((m) => ({ ...m, ...p })), []);

  // "n분째" 경과 표시를 위한 분 단위 재렌더
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const wit = COPY[cfg.wit];
  const me = BY_ID[cfg.memberId] ?? MEMBERS[0]!;
  const now = new Date();
  const todayKey = dayKey(now);
  const yKey = shiftKey(-1);
  const entries = snap.entries;
  const todays = entries.filter((e) => e.day === todayKey);
  const doneSet = new Set(todays.map((e) => e.m));
  const myToday = todays.filter((e) => e.m === me.id).length;

  const closeModal = useCallback(() => setModal(EMPTY_MODAL), []);
  const openNew = () => setModal({ ...EMPTY_MODAL, open: true, day: todayKey });

  const submit = () => {
    const isOff = modal.tag === 'OFF';
    if (!modal.tag || (!isOff && modal.stars <= 0)) return;
    const stamp = new Date();
    const common = {
      tag: modal.tag,
      stars: isOff ? null : modal.stars,
      memo: '',
      body: modal.body.trim(),
      todos: modal.todos.filter((t) => t.t.trim()).map((t) => ({ t: t.t.trim(), done: t.done })),
      day: modal.day || dayKey(stamp),
      updatedAt: stamp.toISOString(),
      deletedAt: null,
    };
    if (modal.editingId) {
      const orig = store.getById(modal.editingId);
      if (orig) store.upsert({ ...orig, ...common });
    } else {
      store.upsert({
        id: crypto.randomUUID(),
        m: me.id,
        time: `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`,
        v: 0, // 신규 행 — 서버 리비전 없음
        ...common,
      });
    }
    closeModal();
  };

  const actions = {
    onEdit: (e: Entry) =>
      setModal({
        open: true,
        editingId: e.id,
        tag: e.tag,
        stars: e.stars ?? 0,
        // 예전 한 줄 메모는 본문 첫 줄로 승격해서 이어 쓴다
        body: [e.memo, e.body].filter(Boolean).join('\n'),
        todos: e.todos.map((t) => ({ ...t })),
        day: e.day,
      }),
    onDelete: (e: Entry) => store.remove(e.id),
    onToggleTodo: (e: Entry, i: number) =>
      store.upsert({
        ...e,
        todos: e.todos.map((t, j) => (j === i ? { ...t, done: !t.done } : t)),
        updatedAt: new Date().toISOString(),
      }),
  };

  return (
    <div className="screen">
      <div className="shell">
        <div className="left">
          <div className="brand-row">
            <div className="brand">러닝 크루 👟</div>
            <div className="stack">
              {MEMBERS.map((m) => (
                <Avatar key={m.id} m={m} size={34} className="stack-av" bg={m.soft} />
              ))}
            </div>
          </div>
          <div className="sub">
            {now.getMonth() + 1}월 {now.getDate()}일 {W[now.getDay()]}요일 · {wit.greeting}
          </div>
          <button className="cta" onClick={openNew}>
            <span className="cta-ico">
              <Icon d={PENCIL_D} size={16} sw={2.2} />
            </span>
            <span>{wit.cta}</span>
          </button>
          <div className="cta-cap">
            <span className="cta-cap-dot" />
            <span>{myToday > 0 ? wit.ctaSome(myToday) : wit.ctaNone}</span>
          </div>
          <StatusBar status={snap.statuses[me.id]} wit={wit} now={nowTick}
            onSet={(on, place) => {
              store.setMyStatus(on, place);
              setNowTick(Date.now());
            }} />
          {cfg.token && <NotifyToggle token={cfg.token} />}
          {cfg.token && <SyncStatus sync={snap.sync} />}
          <div className="board-head">
            <div className="board-title">오늘의 크루</div>
            <div className="board-meta">
              <div className="board-dots">
                {MEMBERS.map((m) => (
                  <span key={m.id} className="board-dot"
                    style={{ background: doneSet.has(m.id) ? m.color : '#E4E7EC' }} />
                ))}
              </div>
              <span className="board-count">{wit.count(doneSet.size)}</span>
            </div>
          </div>
          <Board todays={todays} statuses={snap.statuses} now={nowTick} meId={me.id} wit={wit} />
        </div>
        <div className="feed-col">
          <div className="tabs">
            <button className={'tab' + (view === 'cal' ? ' on' : '')} onClick={() => setView('cal')}>캘린더</button>
            <button className={'tab' + (view === 'feed' ? ' on' : '')} onClick={() => setView('feed')}>피드</button>
          </div>
          {view === 'feed' ? (
            <Feed entries={entries} todayKey={todayKey} yKey={yKey} meId={me.id}
              editingId={modal.editingId} actions={actions} />
          ) : (
            <CalendarView entries={entries} calOff={calOff} setCalOff={setCalOff}
              selDay={selDay ?? todayKey} setSelDay={setSelDay} todayKey={todayKey}
              meId={me.id} editingId={modal.editingId} wit={wit} actions={actions} />
          )}
          <div className="footer">
            {wit.footer}
            {cfg.demo && <div className="demo-note">데모 모드 — 초대 링크로 접속하면 크루와 동기화됩니다.</div>}
          </div>
        </div>
      </div>
      {modal.open && (
        <EntryModal modal={modal} patch={patch} close={closeModal} submit={submit} wit={wit} />
      )}
    </div>
  );
}
