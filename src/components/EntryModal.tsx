import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { EntryPhoto, Tag, Todo } from '../../shared/types';
import { ENTRY_PHOTO_LIMIT, PUSH_LIMITS, TAGS, isOffTags, normalizeTags } from '../../shared/types';
import { TAGMETA, W, dayKey, pad2, type CopySet } from '../lib/constants';
import type { DurableStorageState } from '../local/store';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useOnline } from '../lib/useOnline';
import { CameraIcon, CheckMark, Icon, PLUS_D, STAR_D, X_D } from './icons';
import { PhotoImg } from './PhotoImg';

export interface ModalState {
  open: boolean;
  /** 신규도 시트를 여는 순간 UUID를 갖는다 — 선택한 blob의 entryId와 최종 Entry id가 같다. */
  entryId: string;
  editingId: string | null;
  /** 고른 공부 종류 — 다중 선택. 항상 normalizeTags를 지난 값(TAGS 순서, 'OFF'면 단독). */
  tags: Tag[];
  stars: number;
  body: string;
  todos: Todo[];
  photos: EntryPhoto[];
  day: string; // YYYY-MM-DD — 새 기록도 지난 날짜를 고를 수 있다
}

export const EMPTY_MODAL: ModalState = {
  open: false, entryId: '', editingId: null, tags: [], stars: 0, body: '', todos: [], photos: [], day: '',
};

export function photoStorageNotice(args: {
  durableStorage: DurableStorageState;
  online: boolean;
  demo: boolean;
  full: boolean;
  hasPhotos: boolean;
}): { text: string; blocksAdd: boolean; tone: 'normal' | 'warn' | 'full' } {
  if (!args.demo && args.durableStorage !== 'ready') {
    if (!args.online) {
      return {
        text: '사진을 안전하게 보관할 수 없어 오프라인에서는 추가할 수 없어요.',
        blocksAdd: true,
        tone: 'warn',
      };
    }
    if (args.hasPhotos) {
      return {
        text: '임시 저장 상태예요. 업로드가 끝날 때까지 페이지를 닫지 마세요.',
        blocksAdd: false,
        tone: 'warn',
      };
    }
  }
  if (args.full) {
    return {
      text: '4장을 다 채웠어요. 빼면 다시 넣을 수 있어요.',
      blocksAdd: true,
      tone: 'full',
    };
  }
  if (!args.demo && !args.online && args.hasPhotos) {
    return {
      text: '오프라인 — 저장하면 대기 상태로 남고 연결되면 올라가요.',
      blocksAdd: false,
      tone: 'normal',
    };
  }
  return { text: '', blocksAdd: false, tone: 'normal' };
}

/** 태그 칩 토글 결과 — 'OFF'(쉬는 날)는 배타적이다.
    OFF를 켜면 나머지는 전부 빠지고, OFF가 켜진 채 다른 태그를 켜면 OFF가 빠진다.
    결과는 항상 normalizeTags를 지나 TAGS 순서로 고정된다 — 순서가 흔들리면 내용이 같은
    기록이 서로를 "변경"으로 보고 헛 동기화가 돈다. */
export function toggledTags(cur: readonly Tag[], t: Tag): Tag[] {
  if (cur.includes(t)) return normalizeTags(cur.filter((x) => x !== t));
  return normalizeTags(t === 'OFF' ? ['OFF'] : [...cur.filter((x) => x !== 'OFF'), t]);
}

/** 저장 문턱과 막힌 이유 — 두 단계로 나뉘어 있던 검사("다음"의 내용 검사, 저장의 태그·별점
    검사)가 시트가 한 장이 되면서 저장 버튼 하나로 모였다. 뜻은 그대로다:
    태그 하나 이상 + (쉬는 날이거나 별점 하나 이상), 그리고 새 기록은 글/할 일/사진이 있어야 한다
    (수정은 예외 — 내용을 지우는 것도 수정이다).
    이유는 채울 순서대로 하나만 돌려준다 — 한 번에 다 늘어놓으면 무엇부터 손대야 할지 흐려진다. */
export function saveGate(
  m: Pick<ModalState, 'editingId' | 'tags' | 'stars' | 'body' | 'todos' | 'photos'>,
  /** 고른 사진을 아직 리사이즈하는 중 — 곧 내용이 될 사진을 두고 "한 줄 적어주세요"라고
      막지 않는다. 저장은 준비가 끝난 뒤에 이어서 실행된다(App이 대기시킨다). */
  preparing = false,
): {
  canSave: boolean;
  hasContent: boolean;
  blocked: string;
} {
  const ready = m.tags.length > 0 && (isOffTags(m.tags) || m.stars > 0);
  const hasContent = !!m.body.trim() || m.todos.some((t) => t.t.trim()) || m.photos.length > 0;
  const canSave = ready && (hasContent || preparing || !!m.editingId);
  const blocked = !m.tags.length ? '무엇을 했는지 골라주세요'
    : !ready ? '만족도를 골라주세요'
      : !canSave ? '기록을 한 줄 적거나 사진을 넣어주세요' : '';
  return { canSave, hasContent, blocked };
}

const CHEVRON_D = 'M6 9l6 6 6-6';
const PREV_D = 'M15 18l-6-6 6-6';
const NEXT_D = 'M9 6l6 6-6 6';

function parseDay(key: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number);
  return { y, m: m - 1, d };
}

function DatePicker({
  sel, onPick,
}: {
  sel: { y: number; m: number; d: number };
  onPick: (day: string) => void;
}) {
  const [view, setView] = useState({ y: sel.y, m: sel.m });
  const now = new Date();
  const t0 = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const isCurMonth = view.y === t0.y && view.m === t0.m;
  const first = new Date(view.y, view.m, 1).getDay();
  const dim = new Date(view.y, view.m + 1, 0).getDate();

  return (
    <div className="cal-pop">
      <div className="cal-pop-head">
        <span className="cal-pop-title">{view.y}년 {view.m + 1}월</span>
        <div className="cal-nav">
          <button className="icon-btn sm" onClick={() =>
            setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 })}
            aria-label="이전 달">
            <Icon d={PREV_D} size={14} sw={2.4} />
          </button>
          <button className="icon-btn sm" disabled={isCurMonth} aria-label="다음 달" onClick={() =>
            setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 })}>
            <Icon d={NEXT_D} size={14} sw={2.4} />
          </button>
        </div>
      </div>
      <div className="cal-pop-week">
        {W.map((w, i) => (
          <span key={w} className={'cal-pop-wd' + (i === 0 ? ' sun' : '')}>{w}</span>
        ))}
      </div>
      <div className="cal-pop-grid">
        {Array.from({ length: first }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: dim }, (_, i) => {
          const n = i + 1;
          const isToday = isCurMonth && n === t0.d;
          const isSel = view.y === sel.y && view.m === sel.m && n === sel.d;
          const isFuture = view.y > t0.y || (view.y === t0.y && (view.m > t0.m || (view.m === t0.m && n > t0.d)));
          return (
            <button
              key={n}
              className={'cal-pop-day' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
              disabled={isFuture}
              onClick={() => onPick(`${view.y}-${pad2(view.m + 1)}-${pad2(n)}`)}
            >
              <span className="cal-pop-num">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EntryModal({
  modal, patch, close, submit, wit, demo, preparing, saving, durableStorage, fallbackRef, onAddFiles, onRemovePhoto,
}: {
  modal: ModalState;
  patch: (p: Partial<ModalState>) => void;
  close: () => void;
  submit: () => void;
  wit: CopySet;
  /** 데모는 네트워크가 없다 — 사진이 즉시 done이라 오프라인 안내가 거짓말이 된다 */
  demo: boolean;
  /** 고른 사진을 리사이즈하는 중 — 저장을 눌러도 App이 끝날 때까지 기다렸다 이어 간다 */
  preparing: boolean;
  /** 삭제된 기록을 새 기록으로 살리며 blob을 복제하는 중 — 저장 스냅샷이 바뀌지 않게 잠근다. */
  saving: boolean;
  durableStorage: DurableStorageState;
  /** 열었던 수정 버튼이 닫는 사이 사라질 수 있다 — 날짜를 바꿔 저장하면 카드가 다른 날 묶음으로
      옮겨가고, 다른 기기에서 그 기록이 지워질 수도 있다. 그때 초점이 갈 자리. */
  fallbackRef: RefObject<HTMLElement | null>;
  /** 고른 파일을 리사이즈해 시트에 붙인다 — 자리 계산·실패 안내는 App이 맡는다
      (스토어와 토스트가 거기 있고, 시트는 그 결과만 그린다) */
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
}) {
  const [todoOpen, setTodoOpen] = useState(modal.todos.length > 0);
  const [calOpen, setCalOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  /* 저장이 막힌 이유는 한 번 눌러 본 뒤부터 보여준다 — 빈 시트를 열자마자 "골라주세요"가
     떠 있으면 아직 시작도 안 한 사람을 다그치는 꼴이 된다. */
  const [tried, setTried] = useState(false);
  const typeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typeTimer.current), []);

  const titleId = useId();
  const bodyId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useFocusTrap(sheetRef, fallbackRef);
  const online = useOnline();

  /* 시트가 통째로 하나로 굴러가므로 본문 칸 안에 또 스크롤이 생기면 스크롤이 두 겹이 된다 —
     내용만큼 칸이 자라게 매번 다시 잰다. border-box라 scrollHeight(테두리 제외)만 넣으면
     테두리 두께만큼 모자라 다시 스크롤이 남는다. */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [modal.body]);

  const sel = parseDay(modal.day || dayKey(new Date()));
  const selDow = new Date(sel.y, sel.m, sel.d).getDay();
  const isToday = modal.day === dayKey(new Date());
  const dateSuffix = modal.editingId ? '· 수정 중' : isToday ? '· 오늘' : '· 지난 기록';

  const isOff = isOffTags(modal.tags);
  const { canSave, hasContent, blocked } = saveGate(modal, preparing);
  const showBlocked = tried && !!blocked;

  const photoFull = modal.photos.length >= ENTRY_PHOTO_LIMIT;
  const photoNotice = photoStorageNotice({
    durableStorage,
    online,
    demo,
    full: photoFull,
    hasPhotos: modal.photos.length > 0 || preparing,
  });

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (saving) return;
      if (calOpen) setCalOpen(false);
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [calOpen, close, saving]);

  return (
    <div className="overlay compose-overlay" onClick={saving ? undefined : close}>
      {/* 트랩은 Tab만 가둔다 — 화면 낭독기에 "여기가 모달"이라고 알리는 건 dialog 의미다 */}
      <div className="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={saving} inert={saving || undefined}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head-row">
          <h2 className="sheet-title" id={titleId}>
            {/* 지난 날짜를 골라 놓고 "오늘"이라고 부르지 않는다 — 바로 아래 날짜 줄과 어긋난다 */}
            {modal.editingId ? '기록 수정' : isToday ? '오늘 기록 남기기' : '기록 남기기'}
          </h2>
          <button className="icon-btn sheet-close" onClick={close} aria-label="닫기">
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        {/* 팝오버는 이 줄을 기준으로 뜬다 — 시트 기준이면 아래로 굴린 뒤에 연 달력이
            화면 밖(시트 맨 위)에 열린다 */}
        <div className="sheet-date-wrap">
          <button className="sheet-date-btn" onClick={() => setCalOpen(!calOpen)} aria-expanded={calOpen}>
            <span className="sheet-date-main">{sel.m + 1}월 {sel.d}일 {W[selDow]}요일</span>
            <span className="sheet-date-suffix">{dateSuffix}</span>
            <Icon d={CHEVRON_D} size={14} sw={2.4} />
          </button>
          {calOpen && (
            <DatePicker
              sel={sel}
              onPick={(day) => { patch({ day }); setCalOpen(false); }}
            />
          )}
        </div>

        <div className="sheet-label">무엇을 했나요</div>
        <div className="tag-chips" role="group" aria-label="무엇을 했나요">
          {TAGS.map((t) => {
            const on = modal.tags.includes(t);
            const tm = TAGMETA[t];
            return (
              <button
                key={t}
                className="tag-chip"
                aria-pressed={on}
                style={on ? { background: tm.bg, color: tm.fg, borderColor: tm.fg } : undefined}
                onClick={() => patch({ tags: toggledTags(modal.tags, t) })}
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="sheet-label">오늘 만족도</div>
        {!isOff ? (
          <div className="star-row" role="group" aria-label="오늘 만족도">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="star-btn" aria-label={`${n}점`}
                aria-pressed={modal.stars === n} onClick={() => patch({ stars: n })}>
                <svg width={22} height={22} viewBox="0 0 24 24" style={{ display: 'block' }}>
                  <path d={STAR_D} fill={n <= modal.stars ? '#FFB800' : '#E4E7EC'} />
                </svg>
              </button>
            ))}
            <span className="star-count" aria-live="polite">
              {modal.stars ? `${modal.stars} / 5` : '눌러서 선택'}
            </span>
          </div>
        ) : (
          <span className="off-note">{wit.offNote}</span>
        )}

        <label className="sheet-label" htmlFor={bodyId}>기록</label>
        <textarea
          id={bodyId}
          ref={bodyRef}
          className="modal-diary"
          value={modal.body}
          placeholder={wit.diaryPh}
          maxLength={PUSH_LIMITS.body}
          autoFocus
          onChange={(ev) => {
            clearTimeout(typeTimer.current);
            typeTimer.current = setTimeout(() => setTyping(false), 900);
            setTyping(true);
            patch({ body: ev.target.value });
          }}
        />

        <div className="sheet-label-row">
          <span className="sheet-label">사진</span>
          <span className={'photo-count' + (photoFull ? ' full' : '')}>
            {modal.photos.length}/{ENTRY_PHOTO_LIMIT}
          </span>
        </div>
        <div className="photo-grid">
          {modal.photos.map((p, i) => (
            <span className="photo-tile" key={p.id}>
              <PhotoImg photoId={p.id} kind="thumb" alt={`첨부한 사진 ${i + 1}`} icon={20}
                immediate />
              <button className="photo-drop" aria-label="이 사진 빼기" onClick={() => onRemovePhoto(p.id)}>
                <Icon d={X_D} size={10} sw={3} />
              </button>
            </span>
          ))}
          {/* 프로토타입의 "사진 선택" 모달 대신 OS 파일 선택기를 연다 — 고르는 자리는
              브라우저가 이미 갖고 있고, 우리가 흉내 낼 수 있는 것도 아니다 */}
          <button
            className="photo-add"
            aria-label="사진 추가"
            disabled={photoFull || photoNotice.blocksAdd}
            onClick={() => fileRef.current?.click()}
          >
            <CameraIcon size={19} />
          </button>
          <input
            ref={fileRef}
            className="photo-file"
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(ev) => {
              const files = [...(ev.target.files ?? [])];
              // 같은 파일을 빼고 다시 골라도 change가 오도록 비운다
              ev.target.value = '';
              if (files.length) onAddFiles(files);
            }}
          />
        </div>
        {photoNotice.text && (
          <div
            className={'photo-hint' + (photoNotice.tone === 'normal' ? '' : ` ${photoNotice.tone}`)}
            role="status"
            aria-live="polite"
          >
            {photoNotice.text}
          </div>
        )}

        <div className="sheet-label-row">
          <span className="sheet-label">할 일</span>
          <button
            className="todo-toggle"
            aria-expanded={todoOpen}
            aria-label={todoOpen ? '할 일 목록 접기' : modal.todos.length ? `할 일 목록 펼치기 (${modal.todos.length})` : '할 일 목록 추가'}
            onClick={() => {
              if (!todoOpen && !modal.todos.length) patch({ todos: [{ t: '', done: false }] });
              setTodoOpen(!todoOpen);
            }}
          >
            {todoOpen ? '접기' : modal.todos.length ? `펼치기 (${modal.todos.length})` : '목록 추가'}
          </button>
        </div>
        {todoOpen && (
          <div className="modal-todos">
            {modal.todos.map((t, i) => (
              <div className="modal-todo-row" key={i}>
                <button
                  className={'todo-check modal-check' + (t.done ? ' done' : '')}
                  aria-label={t.done ? '완료 해제' : '완료로 표시'}
                  onClick={() =>
                    patch({ todos: modal.todos.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })
                  }
                >
                  <CheckMark size={12} />
                </button>
                <input
                  className={'modal-todo-input' + (t.done ? ' done' : '')}
                  value={t.t}
                  placeholder={wit.todoPh}
                  maxLength={PUSH_LIMITS.todoText}
                  autoFocus={i === modal.todos.length - 1 && !t.t}
                  onChange={(ev) =>
                    patch({ todos: modal.todos.map((x, j) => (j === i ? { ...x, t: ev.target.value } : x)) })
                  }
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    if (i === modal.todos.length - 1 && t.t.trim() && modal.todos.length < PUSH_LIMITS.todos) {
                      patch({ todos: [...modal.todos, { t: '', done: false }] });
                    }
                  }}
                />
                <button
                  className="modal-todo-remove"
                  aria-label="이 할 일 지우기"
                  onClick={() => patch({ todos: modal.todos.filter((_, j) => j !== i) })}
                >
                  <Icon d={X_D} size={13} sw={2.4} />
                </button>
              </div>
            ))}
            {modal.todos.length < PUSH_LIMITS.todos && (
              <button className="add-todo" onClick={() => patch({ todos: [...modal.todos, { t: '', done: false }] })}>
                <Icon d={PLUS_D} size={13} sw={2.4} />
                <span>항목 추가</span>
              </button>
            )}
          </div>
        )}

        <div className="sheet-foot">
          {/* 초안 표시와 "왜 저장이 안 되는지"가 한 자리를 나눠 쓴다 — 둘 다 버튼 옆 잔글씨고,
              동시에 할 말이 있는 상황이 아니다(저장이 막혀 있으면 그게 먼저다) */}
          <span className={'draft-note' + (showBlocked ? ' warn' : '')} role="status" aria-live="polite">
            {showBlocked ? blocked
              : saving ? '기록 살리는 중…'
                : preparing ? '사진 준비 중…'
                : hasContent ? (typing ? '쓰는 중…' : '초안 저장됨') : ''}
          </span>
          <button className="cancel-btn" onClick={close}>취소</button>
          <button
            className={'submit' + (canSave ? ' ready' : '')}
            aria-disabled={!canSave}
            aria-busy={preparing || saving}
            onClick={() => { if (canSave) submit(); else setTried(true); }}
          >
            {modal.editingId ? wit.editSubmit : wit.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
