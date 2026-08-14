import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Comment, MemberId, ReactionSet } from '../../shared/types';
import { PUSH_LIMITS, REACTIONS } from '../../shared/types';
import { memberOf, pad2 } from '../lib/constants';
import { tallyReactions } from '../lib/reactions';
import { Avatar, Icon, PLUS_D, X_D } from './icons';
import type { EntryActions } from './EntryCard';

/** 댓글 시각 — 작성 기기의 벽시계(createdAt)를 보는 사람의 로컬 HH:MM으로. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 피커 팝오버의 left — 컨테이닝 블록은 리액션 줄 전체이고, 기준점은 자기를 연 `+` 버튼이다.
    버튼 왼쪽에 맞추되 줄 밖으로는 못 나가게 잡아둔다: 그냥 버튼에 붙이면 칩이 늘어난 카드에서
    190px 팝오버가 오른쪽으로 새어 가로 스크롤이 생기고, 그냥 줄 왼쪽 끝에 두면 어느 버튼에서
    열렸는지 알 수 없는 팝오버가 된다. 줄이 팝오버보다 좁으면(max<0) 0으로 — 왼쪽이 덜 아프다. */
export function clampPopoverLeft(btnLeft: number, rowW: number, popW: number): number {
  const max = Math.max(0, rowW - popW);
  return Math.min(Math.max(btnLeft, 0), max);
}

/** 기록 카드 아래에 붙는 소셜 블록 — 리액션 줄 + 댓글 목록 + 작성 줄.
    쓰기는 전부 스토어(로컬 복제본)로 바로 간다. 네트워크를 기다리는 상태는 없다. */
export function EntrySocial({
  entryId, comments, sets, meId, actions,
}: {
  entryId: string;
  comments: Comment[]; // 스냅샷이 이미 (createdAt, id) 오름차순으로 준다 — 다시 정렬하지 않는다
  sets: ReactionSet[];
  meId: MemberId;
  actions: EntryActions;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [pickLeft, setPickLeft] = useState(0);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const pickWrap = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 피커는 열려 있는 동안에만 문서 리스너를 건다 — 카드가 수십 개라 항상 걸어 두면 그만큼 쌓인다
  useEffect(() => {
    if (!pickOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (!pickWrap.current?.contains(ev.target as Node)) setPickOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPickOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickOpen]);

  // 알약을 눌러 펼친 순간 바로 쓸 수 있게 — 한 번 더 탭하게 만들지 않는다
  useEffect(() => {
    if (writing) inputRef.current?.focus();
  }, [writing]);

  const tally = tallyReactions(sets, meId);
  const myEmojis = sets.find((s) => s.m === meId)?.emojis ?? [];
  const me = memberOf(meId);

  // 열린 직후 한 번 재서 팝오버 위치를 잡는다 — 버튼 위치는 칩 개수에 따라 매 카드 다르니
  // CSS만으로는 못 맞춘다(동적 위치라 인라인 style이 맞다). 그리기 전에 끝내야 팝오버가
  // 왼쪽에서 제자리로 튀지 않으므로 useEffect가 아니라 useLayoutEffect다.
  useLayoutEffect(() => {
    if (!pickOpen) return;
    const row = rowRef.current;
    const pop = pickRef.current;
    const add = addRef.current;
    if (!row || !pop || !add) return;
    const popW = pop.offsetWidth;
    // 아직 폭을 못 재면(레이아웃 전) CSS 기본값 left:0으로 두고 다음 열림에서 다시 잰다
    setPickLeft(popW > 0 ? clampPopoverLeft(add.offsetLeft, row.clientWidth, popW) : 0);
  }, [pickOpen, tally.length]);

  const submit = () => {
    if (!text.trim()) return;
    actions.onAddComment(entryId, text);
    // 입력만 비우고 펼친 상태는 유지한다 — 연달아 다는 흐름을 끊지 않는다
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="entry-social">
      <div className="react-row" ref={rowRef}>
        {tally.map((t) => (
          <button
            key={t.emoji}
            className={'react-chip' + (t.mine ? ' mine' : '')}
            aria-pressed={t.mine}
            title={t.names.join(', ')}
            onClick={() => actions.onToggleReaction(entryId, t.emoji)}
          >
            <span className="react-chip-emoji">{t.emoji}</span>
            {t.n}
          </button>
        ))}
        <div className="react-pick-wrap" ref={pickWrap}>
          {pickOpen && (
            <div className="react-pick" ref={pickRef} style={{ left: pickLeft }}>
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  className={'react-pick-btn' + (myEmojis.includes(emoji) ? ' on' : '')}
                  aria-label={emoji}
                  aria-pressed={myEmojis.includes(emoji)}
                  onClick={() => {
                    actions.onToggleReaction(entryId, emoji);
                    setPickOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <button
            ref={addRef}
            className={'react-add' + (pickOpen ? ' open' : '')}
            aria-label="리액션 추가"
            aria-expanded={pickOpen}
            onClick={() => setPickOpen((v) => !v)}
          >
            <Icon d={PLUS_D} size={13} sw={2.4} />
          </button>
        </div>
      </div>

      {comments.length > 0 && (
        <div className="comment-list">
          {comments.map((c) => {
            // 모르는 멤버 id는 중립 표시로 — 남의 이름으로 서명된 댓글이 되면 안 된다
            const cm = memberOf(c.m);
            return (
              <div className="comment" key={c.id}>
                <Avatar m={cm} size={24} />
                <div className="comment-main">
                  <div className="comment-head">
                    <span className="comment-name">{cm.name}</span>
                    <span className="comment-time">{hhmm(c.createdAt)}</span>
                    {c.m === meId && (
                      <button className="comment-del" aria-label="댓글 삭제"
                        onClick={() => actions.onDeleteComment(c.id)}>
                        <Icon d={X_D} size={10} sw={2.6} />
                      </button>
                    )}
                  </div>
                  <div className="comment-body">{c.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="comment-form">
        <Avatar m={me} size={24} />
        {writing ? (
          <div className="comment-input-wrap">
            <input
              ref={inputRef}
              className="comment-input"
              value={text}
              placeholder="댓글 달기…"
              maxLength={PUSH_LIMITS.commentBody}
              onChange={(ev) => setText(ev.target.value)}
              onKeyDown={(ev) => {
                // 한글은 조합 중 Enter로 글자를 "확정"한다 — 그 Enter까지 제출로 받으면
                // "안녕하세" 같은 미완성 댓글이 그대로 저장된다(댓글은 수정이 없다).
                // 조합 중이면 넘긴다: isComposing이 표준, keyCode 229는 구형 브라우저 폴백.
                if (ev.nativeEvent.isComposing || ev.keyCode === 229) return;
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  submit();
                }
              }}
              // 쓰다 만 내용은 남긴다 — 비었을 때만 조용히 접힌다
              onBlur={() => { if (!text.trim()) setWriting(false); }}
            />
            <button className="comment-submit" disabled={!text.trim()} onClick={submit}>등록</button>
          </div>
        ) : (
          <button className="comment-pill" onClick={() => setWriting(true)}>댓글 달기…</button>
        )}
      </div>
    </div>
  );
}
