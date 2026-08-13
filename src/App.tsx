import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Entry, ReactionEmoji, Tag, Todo } from '../shared/types';
import { PUSH_LIMITS, TAGS } from '../shared/types';
import { contentEqual } from './local/store';
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
import { ConfirmDelete } from './components/ConfirmDelete';

/* ---------- 초안 — "초안 저장됨"이 진짜가 되도록 localStorage에 실제로 저장한다 ----------
   슬롯은 기록별(수정 중인 기록의 id, 신규는 'new')로, 데모/실계정도 접두사로 분리한다 —
   빈 새 기록 모달이 수정 초안을 지우거나, 데모 낙서가 실계정 초안으로 새는 일이 없다.
   수정 초안의 신선도는 "초안을 시작할 때의 기록 내용이 지금도 그대로인가"(contentEqual)로
   판정한다 — updatedAt은 동기화 정산이 내용 변화 없이도 재작성하므로 기준이 될 수 없고,
   시계 비교는 기기 오차·브라우저별 파싱 차이에 흔들린다. */
interface Draft {
  tag: Tag | null;
  stars: number;
  body: string;
  todos: Todo[];
  day: string;
  /** 수정 초안: 초안 시작 시점의 기록 스냅샷 — 내용이 그대로일 때만 복원. 신규는 null. */
  base: Entry | null;
  savedAt: number; // 오래 방치된 초안 정리에만 쓴다
}

const DRAFT_PREFIX = 'lc-draft:';
const DRAFT_TTL_MS = 14 * 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function draftHasContent(d: { body: string; todos: Todo[] }): boolean {
  return !!d.body.trim() || d.todos.some((t) => t.t.trim());
}

/** 읽을 때 방어적으로 정규화한다 — 깨진/구버전 초안이 크래시를 내거나,
    서버가 거부할 값(한도 초과·이상한 날짜)이 큐에 들어가 동기화를 막으면 안 된다. */
function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (!d || typeof d !== 'object' || typeof d.body !== 'string' || !Array.isArray(d.todos)) {
      return null;
    }
    return {
      tag: (TAGS as readonly string[]).includes(d.tag as string) ? (d.tag as Tag) : null,
      stars: typeof d.stars === 'number' && d.stars >= 0 && d.stars <= 5 ? d.stars : 0,
      body: d.body.slice(0, PUSH_LIMITS.body),
      todos: d.todos.slice(0, PUSH_LIMITS.todos).map((t) => ({
        t: String((t as Partial<Todo> | undefined)?.t ?? '').slice(0, PUSH_LIMITS.todoText),
        done: !!(t as Partial<Todo> | undefined)?.done,
      })),
      day: typeof d.day === 'string' && DAY_RE.test(d.day) ? d.day : '',
      base: d.base && typeof d.base === 'object' ? (d.base as Entry) : null,
      savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    };
  } catch {
    return null;
  }
}

// 마지막으로 저장한 초안 내용(키 포함, savedAt 제외) — 같은 내용의 중복 쓰기를 건너뛴다
let lastSavedDraftSig = '';

function saveDraft(key: string, m: ModalState, base: Entry | null): void {
  try {
    if (draftHasContent(m)) {
      const payload = { tag: m.tag, stars: m.stars, body: m.body, todos: m.todos, day: m.day, base };
      const sig = key + '\n' + JSON.stringify(payload);
      if (sig === lastSavedDraftSig) return; // debounce 저장 직후의 닫기 등 — 동일 내용 재직렬화 방지
      localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() } satisfies Draft));
      lastSavedDraftSig = sig;
    } else {
      localStorage.removeItem(key); // 내용을 다 지웠으면 초안도 지운다
      lastSavedDraftSig = '';
    }
  } catch {
    // 저장 공간 초과 등 — 초안은 best-effort
  }
}

function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 접근 불가 환경 — 무시
  }
}

/** 오래 방치되거나 형식이 깨진 초안 정리 — 슬롯이 기록별이라 쌓일 수 있다. */
function pruneDrafts(): void {
  try {
    const cutoff = Date.now() - DRAFT_TTL_MS;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(DRAFT_PREFIX)) continue;
      const d = loadDraft(k);
      if (!d || typeof d.savedAt !== 'number' || d.savedAt < cutoff) localStorage.removeItem(k);
    }
  } catch {
    // 접근 불가 환경 — 무시
  }
}

function modalFromDraft(d: Draft, editingId: string | null, fallbackDay: string): ModalState {
  return {
    open: true, editingId, tag: d.tag, stars: d.stars,
    body: d.body, todos: d.todos, day: d.day || fallbackDay,
  };
}

export function App({ cfg, store }: { cfg: AppConfig; store: CrewStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [view, setView] = useState<'feed' | 'cal'>(cfg.initialView);
  const [calOff, setCalOff] = useState(0);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);
  // 삭제 확인 대기 중인 기록 — 스냅샷에서 다시 찾으므로, 그 사이 다른 기기에서
  // 지워졌다면 물음도 함께 사라진다(이미 없는 걸 두고 물을 이유가 없다)
  const [delId, setDelId] = useState<string | null>(null);
  // 삭제를 확정하면 눌렀던 카드가 사라진다 — 초점이 문서 맨 앞으로 떨어지지 않게 여기로 되돌린다
  const ctaRef = useRef<HTMLButtonElement>(null);
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

  // 초안: 열려 있는 동안 짧게 모아 저장하고, 닫는 순간에도 즉시 저장한다(마지막 타이핑 유실 방지)
  const draftKey = useCallback(
    (editingId: string | null) =>
      `${DRAFT_PREFIX}${cfg.demo ? 'demo:' : ''}${me.id}:${editingId ? 'e:' + editingId : 'new'}`,
    [me.id, cfg.demo],
  );
  // 수정 초안의 기준 — 모달을 연 시점의 기록 스냅샷 (신규는 null)
  const editBase = useRef<Entry | null>(null);
  useEffect(() => pruneDrafts(), []);
  useEffect(() => {
    if (!modal.open) return;
    const t = setTimeout(() => saveDraft(draftKey(modal.editingId), modal, editBase.current), 350);
    return () => clearTimeout(t);
  }, [modal, draftKey]);

  const closeModal = useCallback(() => {
    setModal((m) => {
      if (m.open) saveDraft(draftKey(m.editingId), m, editBase.current);
      return EMPTY_MODAL;
    });
  }, [draftKey]);

  const openNew = () => {
    editBase.current = null;
    const d = loadDraft(draftKey(null));
    if (d && draftHasContent(d)) {
      // 마무리하지 못한 초안이 있으면 이어서 쓴다
      setModal(modalFromDraft(d, null, todayKey));
      return;
    }
    setModal({ ...EMPTY_MODAL, open: true, day: todayKey });
  };

  const submit = () => {
    const isOff = modal.tag === 'OFF';
    if (!modal.tag || (!isOff && modal.stars <= 0)) return;
    const stamp = new Date();
    // 서버 한도로 캡 — 초과분이 큐에 들어가면 400이 배치 전체를 막아 동기화가 멈춘다
    // (본문 초과는 옛 한 줄 메모를 본문에 합치는 수정 경로에서만 생길 수 있다)
    const common = {
      tag: modal.tag,
      stars: isOff ? null : modal.stars,
      memo: '',
      body: modal.body.trim().slice(0, PUSH_LIMITS.body),
      todos: modal.todos
        .filter((t) => t.t.trim())
        .slice(0, PUSH_LIMITS.todos)
        .map((t) => ({ t: t.t.trim().slice(0, PUSH_LIMITS.todoText), done: t.done })),
      day: modal.day || dayKey(stamp),
      updatedAt: stamp.toISOString(),
      deletedAt: null,
    };
    const orig = modal.editingId ? store.getById(modal.editingId) : undefined;
    if (orig && !orig.deletedAt) {
      store.upsert({ ...orig, ...common });
    } else {
      // 신규 — 또는 수정하던 기록이 그 사이 다른 기기에서 삭제된 경우:
      // 쓰던 내용을 조용히 버리는 대신 새 기록으로 살린다
      store.upsert({
        id: crypto.randomUUID(),
        m: me.id,
        time: `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`,
        v: 0, // 신규 행 — 서버 리비전 없음
        ...common,
      });
    }
    removeDraft(draftKey(modal.editingId)); // 제출됐으니 초안은 소임을 다했다
    setModal(EMPTY_MODAL);
  };

  const actions = {
    onEdit: (e: Entry) => {
      editBase.current = e;
      // 이 기록을 고치다 만 초안이 있고 기록 "내용"이 그 뒤로 안 바뀌었으면 이어서 쓴다
      // (updatedAt 비교는 안 된다 — 동기화 정산이 내용 변화 없이도 재작성한다)
      const key = draftKey(e.id);
      const d = loadDraft(key);
      if (d && draftHasContent(d) && d.base && contentEqual(d.base, e)) {
        setModal(modalFromDraft(d, e.id, e.day));
        return;
      }
      if (d) removeDraft(key); // 기록 내용이 그 뒤로 바뀌었다 — 낡은 초안은 버린다
      setModal({
        open: true,
        editingId: e.id,
        tag: e.tag,
        stars: e.stars ?? 0,
        // 예전 한 줄 메모는 본문 첫 줄로 승격해서 이어 쓴다 (서버 한도 내로)
        body: [e.memo, e.body].filter(Boolean).join('\n').slice(0, PUSH_LIMITS.body),
        todos: e.todos.map((t) => ({ ...t })),
        day: e.day,
      });
    },
    // 삭제는 되돌릴 수 없다 — 바로 지우지 않고 한 번 묻는다 (댓글은 그대로 즉시 삭제)
    onDelete: (e: Entry) => setDelId(e.id),
    onToggleTodo: (e: Entry, i: number) =>
      store.upsert({
        ...e,
        todos: e.todos.map((t, j) => (j === i ? { ...t, done: !t.done } : t)),
        updatedAt: new Date().toISOString(),
      }),
    // 소셜 쓰기는 스토어가 곧바로 로컬에 반영하고 큐에 넣는다 — 화면은 네트워크를 기다리지 않는다
    onAddComment: (entryId: string, body: string) => store.addComment(entryId, body),
    onDeleteComment: (id: string) => store.removeComment(id),
    onToggleReaction: (entryId: string, emoji: ReactionEmoji) => store.toggleReaction(entryId, emoji),
  };

  const pendingDel = delId ? entries.find((e) => e.id === delId) ?? null : null;

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
          <button className="cta" ref={ctaRef} onClick={openNew}>
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
              editingId={modal.editingId} comments={snap.comments} reactions={snap.reactions}
              actions={actions} />
          ) : (
            <CalendarView entries={entries} calOff={calOff} setCalOff={setCalOff}
              selDay={selDay ?? todayKey} setSelDay={setSelDay} todayKey={todayKey}
              meId={me.id} editingId={modal.editingId} comments={snap.comments}
              reactions={snap.reactions} wit={wit} actions={actions} />
          )}
          <div className="footer">
            {wit.footer}
            {cfg.demo && <div className="demo-note">데모 모드 — 초대 링크로 접속하면 크루와 동기화됩니다.</div>}
          </div>
        </div>
      </div>
      {modal.open && (
        <EntryModal modal={modal} patch={patch} close={closeModal} submit={submit} wit={wit}
          fallbackRef={ctaRef} />
      )}
      {pendingDel && (
        <ConfirmDelete
          entry={pendingDel}
          wit={wit}
          fallbackRef={ctaRef}
          onCancel={() => setDelId(null)}
          onConfirm={() => {
            store.remove(pendingDel.id);
            removeDraft(draftKey(pendingDel.id)); // 지운 기록의 수정 초안도 함께
            setDelId(null);
          }}
        />
      )}
    </div>
  );
}
