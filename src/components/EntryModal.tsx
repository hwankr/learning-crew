import type { Tag, Todo } from '../../shared/types';
import { TAGS } from '../../shared/types';
import { TAGMETA, W, type CopySet } from '../lib/constants';
import { CheckMark, Icon, PLUS_D, STAR_D, X_D } from './icons';

export interface ModalState {
  open: boolean;
  editingId: string | null;
  tag: Tag | null;
  stars: number;
  memo: string;
  body: string;
  todos: Todo[];
  mode: 'plain' | 'diary' | 'todo';
}

export const EMPTY_MODAL: ModalState = {
  open: false, editingId: null, tag: null, stars: 0, memo: '', body: '', todos: [], mode: 'plain',
};

export function EntryModal({
  modal, patch, close, submit, wit,
}: {
  modal: ModalState;
  patch: (p: Partial<ModalState>) => void;
  close: () => void;
  submit: () => void;
  wit: CopySet;
}) {
  const now = new Date();
  const isOff = modal.tag === 'OFF';
  const ready = !!modal.tag && (isOff || modal.stars > 0);

  return (
    <div className="overlay" onClick={close}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-date">
            {now.getMonth() + 1}월 {now.getDate()}일 {W[now.getDay()]}요일{modal.editingId ? ' · 수정 중' : ' · 오늘'}
          </span>
          <button className="icon-btn sheet-close" onClick={close}>
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        <input
          className="modal-memo"
          value={modal.memo}
          placeholder={wit.memoPh}
          maxLength={60}
          autoFocus
          onChange={(ev) => patch({ memo: ev.target.value })}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && modal.mode === 'plain') submit();
          }}
        />
        <div className="modal-hint">{wit.modalHint}</div>
        <div className="mode-row">
          <button
            className={'mode-btn' + (modal.mode === 'diary' ? ' on' : '')}
            onClick={() => patch({ mode: modal.mode === 'diary' ? 'plain' : 'diary' })}
          >
            <Icon d="M4 6h16M4 12h10M4 18h14" size={13} sw={2.2} />
            <span>일기 쓰기</span>
          </button>
          <button
            className={'mode-btn' + (modal.mode === 'todo' ? ' on' : '')}
            onClick={() =>
              patch({
                mode: modal.mode === 'todo' ? 'plain' : 'todo',
                todos: modal.todos.length ? modal.todos : [{ t: '', done: false }],
              })
            }
          >
            <Icon d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" size={13} sw={2.2} />
            <span>할 일 목록</span>
          </button>
        </div>
        {modal.mode === 'diary' && (
          <textarea
            className="modal-diary"
            rows={5}
            value={modal.body}
            placeholder={wit.diaryPh}
            onChange={(ev) => patch({ body: ev.target.value })}
          />
        )}
        {modal.mode === 'todo' && (
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
                  autoFocus={i === modal.todos.length - 1 && !t.t}
                  onChange={(ev) =>
                    patch({ todos: modal.todos.map((x, j) => (j === i ? { ...x, t: ev.target.value } : x)) })
                  }
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    if (i === modal.todos.length - 1 && t.t.trim()) {
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
            <button className="add-todo" onClick={() => patch({ todos: [...modal.todos, { t: '', done: false }] })}>
              <Icon d={PLUS_D} size={13} sw={2.4} />
              <span>항목 추가</span>
            </button>
          </div>
        )}
        <div className="modal-sec">
          <span className="sec-label pt">
            <Icon d="M12 2l8 5v10l-8 5-8-5V7z" size={13} sw={2} />
            <span>태그</span>
          </span>
          <div className="tag-chips">
            {TAGS.map((t) => {
              const on = modal.tag === t;
              const tm = TAGMETA[t];
              return (
                <button
                  key={t}
                  className="tag-chip"
                  style={on ? { background: tm.bg, color: tm.fg, borderColor: tm.fg } : undefined}
                  onClick={() => patch({ tag: on ? null : t })}
                >
                  <Icon d={tm.icon} size={14} sw={2} />
                  <span>{t}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="modal-sec center">
          <span className="sec-label">
            <Icon d={STAR_D} size={13} sw={2} />
            <span>별점</span>
          </span>
          {!isOff ? (
            <div className="star-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="star-btn" onClick={() => patch({ stars: n })}>
                  <svg width={30} height={30} viewBox="0 0 24 24" style={{ display: 'block' }}>
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
        <button className={'submit' + (ready ? ' ready' : '')} onClick={submit}>
          {modal.editingId ? wit.editSubmit : wit.submit}
        </button>
      </div>
    </div>
  );
}
