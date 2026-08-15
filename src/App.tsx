import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Entry, EntryPhoto, ReactionEmoji, Tag, Todo } from '../shared/types';
import {
  ENTRY_PHOTO_LIMIT,
  PUSH_LIMITS,
  UUID_RE,
  canonicalUuid,
  entryTags,
  isOffTags,
  normalizePhotos,
  normalizeTags,
  primaryTag,
} from '../shared/types';
import { ImageDecodeError } from './lib/image';
import { addDraftPhotos } from './lib/photoDraft';
import { lightboxIndex, shownPhotos } from './lib/photos';
import { PhotoLimitError, contentEqual } from './local/store';
import { BY_ID, COPY, MEMBERS, W, dayKey, pad2, shiftKey } from './lib/constants';
import type { AppConfig } from './lib/config';
import type { CrewStore } from './local/store';
import { isDayKey, loadUi, saveUi, type MobileTab } from './lib/uiState';
import { useIsDesktop } from './lib/useMediaQuery';
import { TopBar } from './components/TopBar';
import { TabBar } from './components/TabBar';
import { Fab } from './components/Fab';
import { CrewPanel } from './components/CrewPanel';
import { Feed } from './components/Feed';
import { CalendarView } from './components/CalendarView';
import { NotiPage } from './components/NotiPage';
import { NotiDropdown } from './components/NotiDropdown';
import { NotiSettings } from './components/NotiSettings';
import { EMPTY_MODAL, EntryModal, saveGate, type ModalState } from './components/EntryModal';
import { PhotoLightbox } from './components/PhotoLightbox';
import { ConfirmDelete } from './components/ConfirmDelete';
import { Toast } from './components/Toast';

/* ---------- 초안 — "초안 저장됨"이 진짜가 되도록 localStorage에 실제로 저장한다 ----------
   슬롯은 기록별(수정 중인 기록의 id, 신규는 'new')로, 데모/실계정도 접두사로 분리한다 —
   빈 새 기록 모달이 수정 초안을 지우거나, 데모 낙서가 실계정 초안으로 새는 일이 없다.
   수정 초안의 신선도는 "초안을 시작할 때의 기록 내용이 지금도 그대로인가"(contentEqual)로
   판정한다 — updatedAt은 동기화 정산이 내용 변화 없이도 재작성하므로 기준이 될 수 없고,
   시계 비교는 기기 오차·브라우저별 파싱 차이에 흔들린다. */
interface Draft {
  /** 새 기록도 파일 선택 전에 id를 만든다 — photoBlobs.entryId와 저장될 Entry id가 같다. */
  entryId: string;
  tags: Tag[];
  stars: number;
  body: string;
  todos: Todo[];
  photos: EntryPhoto[];
  day: string;
  /** 수정 초안: 초안 시작 시점의 기록 스냅샷 — 내용이 그대로일 때만 복원. 신규는 null. */
  base: Entry | null;
  savedAt: number; // 오래 방치된 초안 정리에만 쓴다
}

const DRAFT_PREFIX = 'lc-draft:';
const DRAFT_TTL_MS = 14 * 86_400_000;

function draftHasContent(d: { body: string; todos: Todo[]; photos: EntryPhoto[] }): boolean {
  return !!d.body.trim() || d.todos.some((t) => t.t.trim()) || d.photos.length > 0;
}

/** 저장된 기록 스냅샷의 구버전 경계 보정 — 초안 base도 현재 Entry 모양으로 되살린다. */
function withTags(e: Entry): Entry {
  const tags = entryTags(e);
  return { ...e, tags, tag: primaryTag(tags), photos: normalizePhotos(e.photos) };
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
    // 구버전 초안(단일 tag)도 이어 쓸 수 있게 — 새 tags가 없으면 옛 tag에서 되살린다.
    // 잘못된 값은 빈 배열(= 아직 안 고름)이지 '기타'가 아니다: entryTags의 되살림은
    // 저장된 기록용 규칙이고, 초안은 사용자가 고르지 않았다는 사실을 그대로 남겨야 한다.
    const legacyTag = (d as { tag?: unknown }).tag;
    return {
      entryId:
        typeof d.entryId === 'string' && UUID_RE.test(d.entryId)
          ? canonicalUuid(d.entryId)
          : '',
      tags: d.tags === undefined ? normalizeTags([legacyTag]) : normalizeTags(d.tags),
      stars: typeof d.stars === 'number' && d.stars >= 0 && d.stars <= 5 ? d.stars : 0,
      body: d.body.slice(0, PUSH_LIMITS.body),
      todos: d.todos.slice(0, PUSH_LIMITS.todos).map((t) => ({
        t: String((t as Partial<Todo> | undefined)?.t ?? '').slice(0, PUSH_LIMITS.todoText),
        done: !!(t as Partial<Todo> | undefined)?.done,
      })),
      photos: normalizePhotos(d.photos),
      day: isDayKey(d.day) ? d.day : '',
      // 초안 기준 스냅샷도 파생을 채워 둔다 — 다중 태그 이전에 저장된 base는 tags가 없어
      // contentEqual이 무조건 불일치가 되고, 멀쩡한 수정 초안이 통째로 버려진다
      base: d.base && typeof d.base === 'object' ? withTags(d.base as Entry) : null,
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
      const payload = {
        entryId: m.entryId,
        tags: m.tags,
        stars: m.stars,
        body: m.body,
        todos: m.todos,
        photos: m.photos,
        day: m.day,
        base,
      };
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
  // 삭제 뒤 같은 내용으로 다시 작성해도 저장을 생략하지 않도록 메모이즈 값도 비운다.
  if (lastSavedDraftSig.startsWith(`${key}\n`)) lastSavedDraftSig = '';
}

/** 오래 방치되거나 형식이 깨진 초안 정리 — 슬롯이 기록별이라 쌓일 수 있다. */
function pruneDrafts(store: CrewStore): void {
  try {
    const cutoff = Date.now() - DRAFT_TTL_MS;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(DRAFT_PREFIX)) continue;
      const d = loadDraft(k);
      if (!d || typeof d.savedAt !== 'number' || d.savedAt < cutoff) {
        if (d) {
          // 수정 초안에는 원래 기록 사진도 함께 든다. 초안에서 새로 더한 것만 버려야
          // 아직 살아 있는 Entry의 로컬 캐시까지 지우지 않는다.
          const basePhotos = new Set(d.base?.photos.map((photo) => photo.id) ?? []);
          for (const photo of d.photos) {
            if (!basePhotos.has(photo.id)) store.removeDraftPhoto(photo.id);
          }
        }
        localStorage.removeItem(k);
      }
    }
  } catch {
    // 접근 불가 환경 — 무시
  }
}

function modalFromDraft(d: Draft, editingId: string | null, fallbackDay: string): ModalState {
  return {
    open: true,
    entryId: editingId ?? (d.entryId || crypto.randomUUID()),
    editingId,
    tags: d.tags,
    stars: d.stars,
    body: d.body,
    todos: d.todos,
    photos: d.photos,
    day: d.day || fallbackDay,
  };
}

export function App({ cfg, store }: { cfg: AppConfig; store: CrewStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // 저장된 화면 상태는 첫 렌더에서 한 번만 읽는다 — 이후엔 아래 state가 원본이다
  const [ui] = useState(loadUi);
  const urlView = cfg.viewFromUrl ? cfg.initialView : null;
  const [view, setView] = useState<'feed' | 'cal'>(
    urlView === 'feed' || urlView === 'cal' ? urlView : ui.view ?? 'cal',
  );
  // 좁은 화면의 탭 — 데스크톱 view와 한 상태로 묶지 않는다(홈·알림은 저쪽에 없는 자리다).
  // ?view=는 두 셸에 각자의 말로 옮긴다: noti/notiset은 여기서 알림 탭이다.
  const [mtab, setMtab] = useState<MobileTab>(
    urlView === 'feed' || urlView === 'cal' ? urlView
      : urlView === 'noti' ? 'alerts'
        : ui.mtab ?? 'home',
  );
  // 상단 바(+벨 드롭다운)와 하단 탭바·기록 버튼은 서로를 대신하는 셸이다 — 어느 쪽을
  // 그릴지가 갈리므로 CSS로는 못 나누고 렌더 중에 폭을 알아야 한다
  const desktop = useIsDesktop();
  // 데스크톱 벨 드롭다운의 열림 — 모바일에는 벨이 없고 알림이 탭 하나를 통째로 쓴다.
  // 설정은 내역이 아니므로 ?view=notiset에서는 닫힌 채로 시작한다.
  const [notiOpen, setNotiOpen] = useState(urlView === 'noti' && !cfg.initialNotiSettings);
  // 알림 설정 — 폭과 무관하게 본문 전체를 쓰는 유일한 알림 화면
  const [notiSettings, setNotiSettings] = useState(cfg.initialNotiSettings);
  const bellRef = useRef<HTMLButtonElement>(null);
  const closeNoti = useCallback(() => setNotiOpen(false), []);
  const [panelOpen, setPanelOpen] = useState(ui.panelOpen ?? false);
  const [selDay, setSelDay] = useState<string | null>(ui.selDay ?? null);
  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);
  // 삭제 확인 대기 중인 기록 — 스냅샷에서 다시 찾으므로, 그 사이 다른 기기에서
  // 지워졌다면 물음도 함께 사라진다(이미 없는 걸 두고 물을 이유가 없다)
  const [delId, setDelId] = useState<string | null>(null);
  /* 열려 있는 사진 확대 뷰 — 기록 id로 들고 있어 그 사이 기록이나 사진이 사라지면 함께
     닫힌다. 자리는 숫자가 아니라 photoId로 잡는다: 보는 동안 앞쪽 사진의 업로드가 끝나
     목록이 늘어나면 같은 숫자가 다른 사진을 가리킨다. */
  const [light, setLight] = useState<{ entryId: string; photoId: string } | null>(null);
  /* 사진 준비(디코드·리사이즈)는 시트 한 세션에 묶인다. 세션이 끝난 뒤 도착한 결과는 붙일
     자리가 없어 되돌리고, 준비가 남아 있는 동안 누른 저장은 끝날 때까지 기다렸다 이어 간다 —
     기다리지 않으면 방금 고른 사진이 조용히 빠지고 주인 없는 blob만 남는다. */
  const photoSession = useRef(0);
  const [preparing, setPreparing] = useState(0);
  const [waitingSave, setWaitingSave] = useState(false);
  // 삭제를 확정하면 눌렀던 카드가 사라진다 — 초점이 문서 맨 앞으로 떨어지지 않게 여기로 되돌린다
  const ctaRef = useRef<HTMLButtonElement>(null);
  const patch = useCallback((p: Partial<ModalState>) => setModal((m) => ({ ...m, ...p })), []);

  // 토스트 — 같은 문구가 연달아 와도 다시 튀어야 하므로 번호를 붙여 노드를 갈아 끼운다
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string) => {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, text }));
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
  }, []);

  // 보던 탭·패널·날짜를 남긴다 — 새로고침이 화면을 처음으로 되돌리면 안 된다
  // (넓은 셸과 좁은 셸의 탭은 각자 저장한다: 폭이 바뀌어도 보던 자리가 서로를 덮지 않는다)
  useEffect(() => saveUi({ view, mtab, panelOpen, selDay }), [view, mtab, panelOpen, selDay]);

  // "n분째" 경과 표시를 위한 분 단위 재렌더
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const wit = COPY;
  const me = BY_ID[cfg.memberId] ?? MEMBERS[0]!;
  const now = new Date();
  const todayKey = dayKey(now);
  const yKey = shiftKey(-1);
  const entries = snap.entries;
  const todays = entries.filter((e) => e.day === todayKey);

  // 초안: 열려 있는 동안 짧게 모아 저장하고, 닫는 순간에도 즉시 저장한다(마지막 타이핑 유실 방지)
  const draftKey = useCallback(
    (editingId: string | null) =>
      `${DRAFT_PREFIX}${cfg.demo ? 'demo:' : ''}${me.id}:${editingId ? 'e:' + editingId : 'new'}`,
    [me.id, cfg.demo],
  );
  // 수정 초안의 기준 — 모달을 연 시점의 기록 스냅샷 (신규는 null)
  const editBase = useRef<Entry | null>(null);
  useEffect(() => pruneDrafts(store), [store]);
  // 열린 시트가 참조하는 blob은 원격 Entry 삭제·사진 변경을 채택해도 시트가
  // 닫히거나 살리기를 끝낼 때까지 남겨 둔다. 목록 교체를 한 번에 해 사진 패치 사이에
  // 순간적으로 pin이 전부 풀리지 않게 한다.
  useLayoutEffect(() => {
    store.setActiveDraftPhotoIds(modal.open ? modal.photos.map((photo) => photo.id) : []);
  }, [store, modal.open, modal.photos]);
  useEffect(() => () => store.setActiveDraftPhotoIds([]), [store]);
  useEffect(() => {
    if (!modal.open) return;
    const t = setTimeout(() => saveDraft(draftKey(modal.editingId), modal, editBase.current), 350);
    return () => clearTimeout(t);
  }, [modal, draftKey]);

  const closeModal = useCallback(() => {
    photoSession.current += 1; // 이 세션은 끝났다 — 준비 중이던 사진 결과는 되돌아간다
    setModal((m) => {
      if (m.open) saveDraft(draftKey(m.editingId), m, editBase.current);
      return EMPTY_MODAL;
    });
  }, [draftKey]);

  const openNew = () => {
    // 자정을 지난 직후에도 마지막 분 단위 렌더의 날짜를 쓰지 않도록, 여는 순간 다시 읽는다
    const openDay = dayKey(new Date());
    photoSession.current += 1;
    editBase.current = null;
    const d = loadDraft(draftKey(null));
    if (d && draftHasContent(d)) {
      // 마무리하지 못한 초안이 있으면 이어서 쓴다
      setModal(modalFromDraft(d, null, openDay));
      return;
    }
    setModal({ ...EMPTY_MODAL, open: true, entryId: crypto.randomUUID(), day: openDay });
  };

  const submitNow = () => {
    const isOff = isOffTags(modal.tags);
    if (modal.tags.length === 0 || (!isOff && modal.stars <= 0)) return;
    photoSession.current += 1; // 저장으로 세션이 끝난다
    const stamp = new Date();
    // 서버 한도로 캡 — 초과분이 큐에 들어가면 400이 배치 전체를 막아 동기화가 멈춘다
    // (본문 초과는 옛 한 줄 메모를 본문에 합치는 수정 경로에서만 생길 수 있다)
    const common = {
      tags: modal.tags,
      tag: primaryTag(modal.tags), // 파생 필드 — 직접 고르는 값이 아니다
      stars: isOff ? null : modal.stars,
      memo: '',
      body: modal.body.trim().slice(0, PUSH_LIMITS.body),
      todos: modal.todos
        .filter((t) => t.t.trim())
        .slice(0, PUSH_LIMITS.todos)
        .map((t) => ({ t: t.t.trim().slice(0, PUSH_LIMITS.todoText), done: t.done })),
      day: modal.day || dayKey(stamp),
      photos: normalizePhotos(modal.photos),
      updatedAt: stamp.toISOString(),
      deletedAt: null,
    };
    const orig = modal.editingId ? store.getById(modal.editingId) : undefined;
    const isEdit = !!orig && !orig.deletedAt;
    if (orig && !orig.deletedAt) {
      store.upsert({ ...orig, ...common });
    } else {
      // 신규 — 또는 수정하던 기록이 그 사이 다른 기기에서 삭제된 경우:
      // 쓰던 내용을 조용히 버리는 대신 새 기록으로 살린다. 수정 살리기는 삭제된
      // Entry의 photoId를 재사용하지 않고, 로컬 blob이 남은 항목만 새 UUID로 복제한다.
      const id =
        !modal.editingId && UUID_RE.test(modal.entryId)
          ? modal.entryId
          : crypto.randomUUID();
      const photos = modal.editingId
        ? store.cloneDraftPhotosForEntry(common.photos, id)
        : common.photos;
      store.upsert({
        id,
        m: me.id,
        time: `${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`,
        v: 0, // 신규 행 — 서버 리비전 없음
        ...common,
        photos,
      });
    }
    removeDraft(draftKey(modal.editingId)); // 제출됐으니 초안은 소임을 다했다
    setModal(EMPTY_MODAL);
    /* 시트가 닫히면 방금 저장한 기록이 화면 어디에 놓였는지 바로 안 보인다 — 지난 날짜로
       남기면 오늘 묶음에 없고, 캘린더 탭이면 선택일이 그 날이 아닐 수도 있다 */
    showToast(isEdit ? wit.edited : common.day === dayKey(stamp) ? wit.savedToday : wit.savedPast);
  };

  /* 사진이 아직 리사이즈 중이면 저장을 그 자리에서 실행하지 않는다 — 지금 저장하면
     준비가 끝난 사진은 붙을 시트가 없어 버려진다. 준비가 끝나는 대로 이어서 저장한다. */
  const submit = () => {
    if (preparing > 0) {
      setWaitingSave(true);
      return;
    }
    submitNow();
  };
  useEffect(() => {
    if (!waitingSave || preparing > 0) return;
    setWaitingSave(false);
    // 준비하던 사진이 다 실패해 저장 문턱이 무너졌으면 시트를 그대로 둔다(이유는 시트가 말한다).
    // 기다리는 사이 시트를 닫았다면 저장도 함께 취소된 것으로 본다.
    if (modal.open && saveGate(modal).canSave) submitNow();
    // modal이 deps에 있어 이 effect는 늘 그 렌더의 submitNow를 본다
  }, [waitingSave, preparing, modal]);

  const actions = {
    onEdit: (e: Entry) => {
      photoSession.current += 1;
      editBase.current = e;
      // 이 기록을 고치다 만 초안이 있고 기록 "내용"이 그 뒤로 안 바뀌었으면 이어서 쓴다
      // (updatedAt 비교는 안 된다 — 동기화 정산이 내용 변화 없이도 재작성한다)
      const key = draftKey(e.id);
      const d = loadDraft(key);
      if (d && draftHasContent(d) && d.base && contentEqual(d.base, e)) {
        setModal(modalFromDraft(d, e.id, e.day));
        return;
      }
      if (d) {
        // 기록 내용이 그 뒤로 바뀌었다 — 낡은 초안 메타와 거기에만 달린 blob을 함께 버린다.
        for (const photo of d.photos) {
          if (!e.photos.some((current) => current.id === photo.id)) store.removeDraftPhoto(photo.id);
        }
        removeDraft(key);
      }
      setModal({
        open: true,
        entryId: e.id,
        editingId: e.id,
        tags: entryTags(e), // 구버전 IDB 행(tags 없음)도 대표 태그에서 되살린다
        stars: e.stars ?? 0,
        // 예전 한 줄 메모는 본문 첫 줄로 승격해서 이어 쓴다 (서버 한도 내로)
        body: [e.memo, e.body].filter(Boolean).join('\n').slice(0, PUSH_LIMITS.body),
        todos: e.todos.map((t) => ({ ...t })),
        photos: normalizePhotos(e.photos),
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
    onOpenPhoto: (e: Entry, photoId: string) => setLight({ entryId: e.id, photoId }),
    // 실패한 사진만 다시 큐에 들어간다 — 큐가 판정하고 배지는 그 결과를 따라 바뀐다
    onRetryPhoto: (photoId: string) => store.retryPhoto(photoId),
  };

  /* 파일 선택 → 리사이즈 → 시트에 붙이기. 남은 자리보다 많이 고르면 앞에서부터 채우고
     나머지는 토스트로 알린다 — 조용히 버리면 몇 장이 들어갔는지 알 수 없다. */
  const onAddFiles = (files: File[]) => {
    const room = ENTRY_PHOTO_LIMIT - modal.photos.length;
    if (room <= 0) {
      showToast(wit.photoFull);
      return;
    }
    if (files.length > room) showToast(wit.photoRoom(room));
    const session = photoSession.current;
    const entryId = modal.entryId;
    const before = modal.photos;
    setPreparing((n) => n + 1);
    void addDraftPhotos({
      files,
      room,
      // 이 묶음에서 이미 붙인 사진도 자리 계산에 넣는다 — 디코드는 한 장씩 끝나지만
      // 스토어의 네 장 경계는 "지금 시트에 있는 전부"를 기준으로 세야 한다
      prepare: (file, added) => store.addPhoto(entryId, file, [...before, ...added]),
      isCurrent: () => photoSession.current === session,
      attach: (photo) => setModal((m) => (m.open ? { ...m, photos: [...m.photos, photo] } : m)),
      discard: (id) => store.removeDraftPhoto(id),
      onError: (err) =>
        showToast(
          err instanceof PhotoLimitError ? wit.photoFull
            : err instanceof ImageDecodeError ? wit.photoUnreadable
              : wit.photoFailed,
        ),
    })
      .catch(() => undefined)
      .finally(() => setPreparing((n) => n - 1));
  };

  const onRemovePhoto = (photoId: string) => {
    patch({ photos: modal.photos.filter((p) => p.id !== photoId) });
    const saved = modal.editingId ? store.getById(modal.editingId) : undefined;
    const inEntry = !!saved?.photos.some((p) => p.id === photoId);
    const status = snap.photoUploads.get(photoId);
    /* 로컬 JPEG는 바로 버려야 그 자리에 다른 사진을 넣을 수 있다. 다만 아직 못 올린
       사진이나 데모(서버 없음)의 사진은 이 파일이 유일본이라, 시트를 취소하면 기록에
       남은 사진이 깨진다 — 그 경우에만 남겨 두고 저장 때의 정산에 맡긴다.
       남겨 두더라도 스토어의 네 장 경계에서는 빼야 그 자리에 다른 사진이 들어간다. */
    const recoverable = !cfg.demo && (!status || status.state === 'done');
    if (!inEntry || recoverable) store.removeDraftPhoto(photoId);
    else store.detachDraftPhoto(photoId);
  };

  // 사진이 다 사라졌으면(삭제·기록 소멸) 확대 뷰도 닫힌 것으로 본다
  const lightEntry = light ? entries.find((e) => e.id === light.entryId) ?? null : null;
  const lightPhotos = lightEntry
    ? shownPhotos(lightEntry.photos, lightEntry.m === me.id, snap.photoUploads)
    : [];
  // 자리는 볼 때마다 지금 목록에서 다시 센다 — 보관하는 값은 photoId 하나다
  const lightIdx = light ? lightboxIndex(lightPhotos, light.photoId) : 0;

  const pendingDel = delId ? entries.find((e) => e.id === delId) ?? null : null;

  const footer = (
    <div className="footer">
      {wit.footer}
      {cfg.demo && <div className="demo-note">데모 모드 — 초대 링크로 접속하면 크루와 동기화됩니다.</div>}
    </div>
  );
  // 두 셸이 같은 화면을 나눠 쓴다 — 상단 바 아래 본문이든 하단 탭 위 본문이든 내용은 하나다
  const feedScreen = (
    <div className="feed-wrap">
      <Feed entries={entries} todayKey={todayKey} yKey={yKey} meId={me.id}
        editingId={modal.editingId} comments={snap.comments} reactions={snap.reactions}
        photoUploads={snap.photoUploads} wit={wit} actions={actions} />
      {footer}
    </div>
  );
  const calScreen = (
    <>
      <CalendarView entries={entries} selDay={selDay ?? todayKey}
        setSelDay={setSelDay} todayKey={todayKey}
        meId={me.id} editingId={modal.editingId} comments={snap.comments}
        reactions={snap.reactions} photoUploads={snap.photoUploads} wit={wit} actions={actions} />
      {footer}
    </>
  );
  const crewScreen = (
    <CrewPanel entries={entries} todays={todays} statuses={snap.statuses} meId={me.id}
      now={nowTick} today={now} wit={wit} sync={cfg.token ? snap.sync : null}
      photoUploads={snap.photoUploads}
      onOpenPhoto={(e, photoId) => setLight({ entryId: e.id, photoId })}
      onSetStatus={(on, place) => {
        store.setMyStatus(on, place);
        setNowTick(Date.now());
        // 패널을 곧바로 닫아도 시작·종료 결과를 확인할 수 있게 짧은 알림을 남긴다
        showToast(on && place ? wit.statusStarted(place) : wit.statusEnded);
      }} />
  );
  // 설정은 두 셸이 공유하는 알림 하위 화면이다 — 데스크톱에서 연 뒤 폭이 좁아져도
  // 기억해 둔 홈 뒤에 숨지 않도록, 대응하는 모바일 탭도 함께 알림으로 맞춘다.
  const openNotiSettings = () => {
    setNotiOpen(false);
    setMtab('alerts');
    setNotiSettings(true);
  };
  // 설정은 내역의 하위 화면이라 같은 자리에 선다 — 데스크톱은 본문, 모바일은 알림 탭
  const notiScreen = notiSettings ? (
    <NotiSettings token={cfg.token} meId={me.id} demo={cfg.demo}
      // 뒤로 = 데스크톱이면 보던 탭, 좁은 화면이면 이 탭의 내역
      onBack={() => setNotiSettings(false)} />
  ) : (
    <NotiPage notifications={snap.notifications}
      onRead={(id) => store.markNotificationRead(id)}
      onReadAll={() => store.markAllNotificationsRead()}
      onOpenSettings={openNotiSettings} />
  );

  // 떠 있는 기록 버튼은 홈·피드에만 선다 — 캘린더·알림은 아래 여백도 그만큼 줄어든다
  const fabTab = mtab === 'home' || mtab === 'feed';
  const fabOn = fabTab && !modal.open;

  return (
    <div className="screen">
      {desktop ? (
        <>
          <TopBar me={me} wit={wit} view={view}
            onView={(v) => { setView(v); setNotiOpen(false); setNotiSettings(false); }}
            panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)}
            sync={cfg.token ? snap.sync : null}
            unread={snap.unreadNotifications} notiOn={notiOpen}
            // 설정을 보고 있었다면 벨은 그 위의 내역으로 되돌린다
            onBell={() => {
              if (notiSettings) {
                setNotiSettings(false);
                setNotiOpen(true);
              } else {
                setNotiOpen((o) => !o);
              }
            }}
            bellRef={bellRef}
            dropdown={notiOpen ? (
              <NotiDropdown notifications={snap.notifications} unread={snap.unreadNotifications}
                bellRef={bellRef}
                onRead={(id) => store.markNotificationRead(id)}
                onReadAll={() => { store.markAllNotificationsRead(); showToast(wit.notiReadAll); }}
                onOpenSettings={openNotiSettings}
                onOpenFeed={() => { setNotiOpen(false); setView('feed'); }}
                onClose={closeNoti} />
            ) : null}
            onCompose={openNew} composeRef={ctaRef} />
          {/* 패널 열은 접혀 있어도 마운트를 유지한다 — 열 폭만 300ms로 오가고 안쪽 래퍼는
              296px에 고정돼 있어서, 접히는 동안 내용이 찌그러지지 않는다(CSS가 맡는다) */}
          <div className={'body' + (panelOpen ? ' open' : '')}>
            <div className="panel-col">
              <div className="panel-inner">{crewScreen}</div>
            </div>
            <div className="main-col">
              {notiSettings ? notiScreen : view === 'feed' ? feedScreen : calScreen}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={'body' + (fabTab ? ' with-fab' : '')}>
            {mtab === 'home' ? (
              <>
                <div className="mhome-head">
                  <div className="mhome-title">러닝 크루 👟</div>
                  <div className="mhome-sub">
                    {now.getMonth() + 1}월 {now.getDate()}일 {W[now.getDay()]}요일 · {wit.greeting}
                  </div>
                </div>
                {crewScreen}
              </>
            ) : mtab === 'feed' ? feedScreen : mtab === 'cal' ? calScreen : notiScreen}
          </div>
          {/* 기록 버튼이 서지 않는 탭에서는 탭바가 초점의 귀환 지점을 대신 맡는다 —
              두 자리가 같은 ref를 두고 다투지 않게 있는 쪽 하나만 잡는다 */}
          <TabBar tab={mtab} unread={snap.unreadNotifications}
            anchorRef={fabOn ? undefined : ctaRef}
            onTab={(t) => {
              setMtab(t);
              setNotiSettings(false); // 탭을 누르면 그 탭의 첫 화면 — 설정에 갇힌 채 돌아오지 않는다
            }} />
          {fabOn && <Fab done={todays.some((e) => e.m === me.id)} wit={wit} onClick={openNew} btnRef={ctaRef} />}
        </>
      )}
      {modal.open && (
        <EntryModal modal={modal} patch={patch} close={closeModal} submit={submit} wit={wit}
          demo={cfg.demo} preparing={preparing > 0}
          fallbackRef={ctaRef} onAddFiles={onAddFiles} onRemovePhoto={onRemovePhoto} />
      )}
      {lightEntry && lightPhotos.length > 0 && (
        <PhotoLightbox
          entry={lightEntry}
          photos={lightPhotos}
          index={lightIdx}
          onIndex={(i) => {
            const next = lightPhotos[i];
            if (next) setLight({ entryId: lightEntry.id, photoId: next.id });
          }}
          onClose={() => setLight(null)}
          desktop={desktop}
          meId={me.id}
          comments={snap.comments.get(lightEntry.id) ?? []}
          reactions={snap.reactions.get(lightEntry.id) ?? []}
          actions={actions}
          fallbackRef={ctaRef}
        />
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
            showToast(wit.deleted);
          }}
        />
      )}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </div>
  );
}
