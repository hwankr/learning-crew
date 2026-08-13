import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Tag, Todo } from '../../shared/types';
import { PUSH_LIMITS, TAGS, isOffTags, normalizeTags } from '../../shared/types';
import { TAGMETA, W, dayKey, pad2, type CopySet } from '../lib/constants';
import { useFocusTrap } from '../lib/useFocusTrap';
import { CheckMark, Icon, PLUS_D, STAR_D, X_D } from './icons';

export interface ModalState {
  open: boolean;
  editingId: string | null;
  /** 고른 공부 종류 — 다중 선택. 항상 normalizeTags를 지난 값(TAGS 순서, 'OFF'면 단독). */
  tags: Tag[];
  stars: number;
  body: string;
  todos: Todo[];
  day: string; // YYYY-MM-DD — 새 기록도 지난 날짜를 고를 수 있다
}

export const EMPTY_MODAL: ModalState = {
  open: false, editingId: null, tags: [], stars: 0, body: '', todos: [], day: '',
};

/** 태그 칩 토글 결과 — 'OFF'(쉬는 날)는 배타적이다.
    OFF를 켜면 나머지는 전부 빠지고, OFF가 켜진 채 다른 태그를 켜면 OFF가 빠진다.
    결과는 항상 normalizeTags를 지나 TAGS 순서로 고정된다 — 순서가 흔들리면 내용이 같은
    기록이 서로를 "변경"으로 보고 헛 동기화가 돈다. */
export function toggledTags(cur: readonly Tag[], t: Tag): Tag[] {
  if (cur.includes(t)) return normalizeTags(cur.filter((x) => x !== t));
  return normalizeTags(t === 'OFF' ? ['OFF'] : [...cur.filter((x) => x !== 'OFF'), t]);
}

const CHEVRON_D = 'M6 9l6 6 6-6';
const PREV_D = 'M15 18l-6-6 6-6';
const NEXT_D = 'M9 6l6 6-6 6';
const BACK_D = 'M19 12H5M11 18l-6-6 6-6';
const FWD_D = 'M5 12h14M13 6l6 6-6 6';
const TODO_D = 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
const TAGSEC_D = 'M12 2l8 5v10l-8 5-8-5V7z';

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
            setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 })}>
            <Icon d={PREV_D} size={14} sw={2.4} />
          </button>
          <button className="icon-btn sm" style={{ color: isCurMonth ? '#CDD2DB' : undefined }} onClick={() => {
            if (!isCurMonth) setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 });
          }}>
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
  modal, patch, close, submit, wit, fallbackRef,
}: {
  modal: ModalState;
  patch: (p: Partial<ModalState>) => void;
  close: () => void;
  submit: () => void;
  wit: CopySet;
  /** 열었던 수정 버튼이 닫는 사이 사라질 수 있다 — 날짜를 바꿔 저장하면 카드가 다른 날 묶음으로
      옮겨가고, 다른 기기에서 그 기록이 지워질 수도 있다. 그때 초점이 갈 자리. */
  fallbackRef: RefObject<HTMLElement | null>;
}) {
  const [step, setStep] = useState<'write' | 'meta'>('write');
  const [todoOpen, setTodoOpen] = useState(modal.todos.length > 0);
  const [calOpen, setCalOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const typeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typeTimer.current), []);

  const sheetRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useFocusTrap(sheetRef, fallbackRef);

  /* 단계를 넘나들 때 초점도 같이 옮긴다 — 지금까지 초점이 있던 쪽(다음 버튼 / 다시 쓰기 버튼)이
     곧바로 inert가 되므로, 두고 가면 초점이 body로 떨어져 키보드 사용자가 자리를 잃는다.
     "단계가 실제로 바뀌었는지"를 직전 값과 비교해서 본다 — 플래그 한 개로 첫 실행만 걸러내면
     effect가 다시 붙는 상황(StrictMode 등)에서 마운트가 단계 전환으로 둔갑해
     본문 autoFocus를 가로챈다. */
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    (step === 'meta' ? backRef.current : bodyRef.current)?.focus();
  }, [step]);

  const sel = parseDay(modal.day || dayKey(new Date()));
  const selDow = new Date(sel.y, sel.m, sel.d).getDay();
  const isToday = modal.day === dayKey(new Date());
  const dateSuffix = modal.editingId ? '· 수정 중' : isToday ? '· 오늘' : '· 지난 기록';

  const isOff = isOffTags(modal.tags);
  const ready = modal.tags.length > 0 && (isOff || modal.stars > 0);
  const hasContent = !!modal.body.trim() || modal.todos.some((t) => t.t.trim());
  const canNext = hasContent || !!modal.editingId;
  const firstLine = modal.body.trim().split('\n')[0] || '';
  const todoN = modal.todos.filter((t) => t.t.trim()).length;
  const excerpt = firstLine || (todoN ? `할 일 ${todoN}개` : '(내용 없음)');

  return (
    <div className="overlay" onClick={close}>
      {/* 트랩은 Tab만 가둔다 — 화면 낭독기에 "여기가 모달"이라고 알리는 건 dialog 의미다 */}
      <div className="sheet" ref={sheetRef} role="dialog" aria-modal="true"
        aria-label={modal.editingId ? '기록 수정' : '새 기록'}
        onClick={(ev) => ev.stopPropagation()}>
        {/* 메타 패널은 시트를 통째로 덮는다 — 가려진 쪽은 inert로 탭 순서·스크린 리더에서 뺀다.
            (transform으로 밀어 둔 것만으로는 Tab이 그대로 들어간다) */}
        <div className="sheet-head" inert={step === 'meta'}>
          <div className="sheet-head-row">
            <button className="sheet-date-btn" onClick={() => setCalOpen(!calOpen)}>
              <span className="sheet-date-main">{sel.m + 1}월 {sel.d}일 {W[selDow]}요일</span>
              <span className="sheet-date-suffix">{dateSuffix}</span>
              <Icon d={CHEVRON_D} size={14} sw={2.4} />
            </button>
            <button className="icon-btn sheet-close" onClick={close}>
              <Icon d={X_D} size={17} sw={2.4} />
            </button>
          </div>
          {calOpen && (
            <DatePicker
              sel={sel}
              onPick={(day) => { patch({ day }); setCalOpen(false); }}
            />
          )}
        </div>
        <div className="sheet-scroll" inert={step === 'meta'}>
          <textarea
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
          <button
            className="todo-toggle"
            onClick={() => {
              if (!todoOpen && !modal.todos.length) patch({ todos: [{ t: '', done: false }] });
              setTodoOpen(!todoOpen);
            }}
          >
            <Icon d={TODO_D} size={13} sw={2.2} />
            <span>
              {todoOpen ? '할 일 목록 접기' : modal.todos.length ? `할 일 목록 (${modal.todos.length})` : '할 일 목록 추가'}
            </span>
          </button>
          {todoOpen && (
            <div className="modal-todos">
              {modal.todos.map((t, i) => (
                <div className="modal-todo-row" key={i}>
                  <button
                    className={'todo-check modal-check' + (t.done ? ' done' : '')}
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
        </div>
        <div className="sheet-foot" inert={step === 'meta'}>
          <span className="draft-note" style={{ opacity: hasContent ? 1 : 0 }}>
            {hasContent ? (typing ? '쓰는 중…' : '초안 저장됨') : ''}
          </span>
          <button
            className={'next-btn' + (canNext ? ' ready' : '')}
            onClick={() => { if (canNext) { setStep('meta'); setCalOpen(false); } }}
          >
            <span>다음</span>
            <Icon d={FWD_D} size={15} sw={2.4} />
          </button>
        </div>
        <div className={'meta-panel' + (step === 'meta' ? ' on' : '')} inert={step !== 'meta'}>
          <div className="meta-head">
            <button className="back-btn" ref={backRef} onClick={() => setStep('write')}>
              <Icon d={BACK_D} size={15} sw={2.4} />
              <span>다시 쓰기</span>
            </button>
            <span className="sheet-date-suffix">{sel.m + 1}월 {sel.d}일 {W[selDow]}요일</span>
          </div>
          <div className="meta-scroll">
            <div className="meta-excerpt">{excerpt}</div>
            <div className="meta-label tags">
              <Icon d={TAGSEC_D} size={13} sw={2} />
              <span>오늘은 어떤 공부였나요?</span>
              <span className="meta-hint">여러 개 고를 수 있어요</span>
            </div>
            <div className="tag-chips">
              {TAGS.map((t) => {
                const on = modal.tags.includes(t);
                const tm = TAGMETA[t];
                return (
                  <button
                    key={t}
                    className="tag-chip"
                    style={on ? { background: tm.bg, color: tm.fg, borderColor: tm.fg } : undefined}
                    onClick={() => patch({ tags: toggledTags(modal.tags, t) })}
                  >
                    <Icon d={tm.icon} size={15} sw={2} />
                    <span>{t}</span>
                  </button>
                );
              })}
            </div>
            <div className="meta-label stars">
              <Icon d={STAR_D} size={13} sw={2} />
              <span>오늘의 만족도</span>
            </div>
            {!isOff ? (
              <div className="star-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className="star-btn" onClick={() => patch({ stars: n })}>
                    <svg width={34} height={34} viewBox="0 0 24 24" style={{ display: 'block' }}>
                      <path d={STAR_D} fill={n <= modal.stars ? '#FFB800' : '#E4E7EC'} />
                    </svg>
                  </button>
                ))}
                <span className="star-cap">{wit.caps[modal.stars] ?? wit.caps[0]}</span>
              </div>
            ) : (
              <span className="off-note">{wit.offNote}</span>
            )}
          </div>
          <div className="meta-foot">
            <button className={'submit' + (ready ? ' ready' : '')} onClick={submit}>
              {modal.editingId ? wit.editSubmit : wit.submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
