/* 사진 확대 뷰 — 사진과 그 기록의 댓글·리액션을 한 화면에서 본다.
   데스크톱은 가운데 카드(사진 + 오른쪽 340px 패널), 좁은 화면은 풀스크린(사진 + 아래 시트).
   소셜은 카드와 같은 조각(ReactionRow/CommentList/CommentForm)을 쓴다 — 여기서 단 댓글이
   피드 카드에도 그대로 이어져야 하므로 동작을 따로 구현하지 않는다. 다만 배치는 디자인
   원본대로 "굴러가는 본문 + 바닥에 고정된 입력"이라 EntrySocial 통째로는 쓰지 않는다. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Comment, Entry, EntryPhoto, MemberId, ReactionSet } from '../../shared/types';
import { memberOf } from '../lib/constants';
import { useFocusTrap } from '../lib/useFocusTrap';
import { usePhotoUrl } from '../lib/usePhoto';
import { Avatar, Icon, LEFT_D, PhotoIcon, RIGHT_D, X_D } from './icons';
import { CommentForm, CommentList, ReactionRow } from './EntrySocial';
import { PhotoImg } from './PhotoImg';
import type { EntryActions } from './EntryCard';

/** 어두운 무대 위 자리 표시 — 밝은 칸의 먹빛 아이콘은 여기서 보이지 않는다. */
const STAGE_ICON = 'rgba(255,255,255,0.22)';

/** 라이트박스가 키 하나로 무엇을 할지. Escape는 리액션 피커가 열려 있으면 피커 몫이다 —
    둘 다 문서에 리스너를 걸고 있어, 우선순위를 정해 두지 않으면 이모지를 고르다 물러날 때
    라이트박스까지 함께 닫힌다(피커 리스너가 나중에 붙어 stopPropagation으로는 못 막는다). */
export function lightboxKeyAction(
  key: string,
  ctx: { pickerOpen: boolean; inField: boolean },
): 'close' | 'prev' | 'next' | null {
  if (key === 'Escape') return ctx.pickerOpen ? null : 'close';
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  // 댓글을 쓰는 중이라면 화살표는 글자 사이를 오가는 키다 — 사진을 넘기지 않는다
  if (ctx.inField) return null;
  return key === 'ArrowLeft' ? 'prev' : 'next';
}

/** 큰 사진이 도착하기 전에는 이미 갖고 있는 썸네일을 흐리게 깔아 둔다 —
    빈 무대에서 사진이 튀어나오는 대신 자리와 색이 먼저 잡힌다.
    (라운지 라이트박스도 같은 무대를 쓰므로 내보낸다) */
export function StagePhoto({ photo, alt, icon }: { photo: EntryPhoto; alt: string; icon: number }) {
  const thumb = usePhotoUrl(photo.id, 'thumb');
  const full = usePhotoUrl(photo.id, 'full');
  return (
    <>
      <span className="photo-ph" aria-hidden="true">
        <PhotoIcon size={icon} color={STAGE_ICON} sw={1.4} lens />
      </span>
      {thumb.url && !full.url && (
        <img className="light-img blur" src={thumb.url} alt="" aria-hidden="true" />
      )}
      {full.url && <img className="light-img" src={full.url} alt={alt} />}
    </>
  );
}

export function PhotoLightbox({
  entry, photos, index, onIndex, onClose, desktop, meId, comments, reactions, actions, fallbackRef,
}: {
  entry: Entry;
  /** 크게 볼 수 있는 사진만 (shownPhotos) — 비어 있으면 App이 아예 열지 않는다 */
  photos: EntryPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** 폭 갈림길은 App이 이미 알고 있다 — 여기서 다시 재지 않는다 */
  desktop: boolean;
  meId: MemberId;
  comments: Comment[];
  reactions: ReactionSet[];
  actions: EntryActions;
  fallbackRef: RefObject<HTMLElement | null>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 리액션 피커가 열려 있는 동안에는 Escape가 피커 몫이다
  const [pickerOpen, setPickerOpen] = useState(false);
  useFocusTrap(boxRef, fallbackRef);

  // 초점을 닫기로 옮겨 둔다 — 그러지 않으면 초점이 덮인 카드에 남아 어디가 열렸는지 알 수 없다
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // 사진이 지워지거나 다른 기기에서 줄어도 화면 밖 자리를 가리키지 않는다
  const idx = Math.min(Math.max(index, 0), photos.length - 1);
  const cur = photos[idx]!;
  const author = memberOf(entry.m);
  const day = new Date(entry.day + 'T12:00:00');
  const when = `${day.getMonth() + 1}월 ${day.getDate()}일 ${entry.time}`;
  const counter = `${idx + 1} / ${photos.length}`;
  const alt = `${author.name}의 ${when} 기록 사진 ${idx + 1}`;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target;
      const action = lightboxKeyAction(ev.key, {
        pickerOpen,
        inField: t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'),
      });
      if (!action) return;
      if (action === 'close') {
        onClose();
        return;
      }
      ev.preventDefault();
      onIndex(Math.min(Math.max(idx + (action === 'prev' ? -1 : 1), 0), photos.length - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, photos.length, pickerOpen, onClose, onIndex]);

  const nav = (
    <>
      {idx > 0 && (
        <button className="light-nav prev" aria-label="이전 사진" onClick={() => onIndex(idx - 1)}>
          <Icon d={LEFT_D} size={18} sw={2.4} />
        </button>
      )}
      {idx < photos.length - 1 && (
        <button className="light-nav next" aria-label="다음 사진" onClick={() => onIndex(idx + 1)}>
          <Icon d={RIGHT_D} size={18} sw={2.4} />
        </button>
      )}
    </>
  );

  /* 한 장뿐이면 줄을 세우지 않는다 — 고를 것이 없는 자리다(좌우 버튼도 같은 규칙이다) */
  const strip = photos.length > 1 && (
    <div className={'light-strip' + (desktop ? '' : ' mob')}>
      {photos.map((p, i) => (
        <button
          key={p.id}
          className={'light-strip-btn' + (i === idx ? ' on' : '')}
          aria-label={`${i + 1}번째 사진`}
          aria-current={i === idx}
          onClick={() => onIndex(i)}
        >
          <PhotoImg photoId={p.id} kind="thumb" alt="" icon={12} iconColor="rgba(255,255,255,0.3)" />
        </button>
      ))}
    </div>
  );

  /* 디자인 원본 구조: 메모·본문·탤리·댓글은 굴러가고, 댓글 입력만 바닥에 붙는다.
     피커는 아래로 연다 — 탤리가 스크롤 상자 맨 위라 위로 열면 상자 밖에서 잘린다. */
  const scrollBody = (
    <div className="light-scroll">
      {entry.memo && <div className="light-memo">{entry.memo}</div>}
      {entry.body && <div className="light-text">{entry.body}</div>}
      <div className="light-react">
        <ReactionRow entryId={entry.id} sets={reactions} meId={meId} actions={actions}
          below onPickerOpen={setPickerOpen} />
      </div>
      {comments.length > 0 && (
        <div className="light-comments">
          <CommentList comments={comments} meId={meId} onDelete={actions.onDeleteComment} />
        </div>
      )}
    </div>
  );
  const commentBar = (
    <div className="light-foot">
      <CommentForm meId={meId} onSubmit={(body) => actions.onAddComment(entry.id, body)} />
    </div>
  );

  if (!desktop) {
    return (
      <div className="light-full" ref={boxRef} role="dialog" aria-modal="true"
        aria-label="사진 크게 보기">
        <div className="mlight-bar">
          <button className="mlight-close" ref={closeRef} aria-label="닫기" onClick={onClose}>
            <Icon d={X_D} size={16} sw={2.4} />
          </button>
          <span className="mlight-counter">{counter}</span>
          <span className="spacer" />
          <span className="mlight-who">{author.name} · {when}</span>
        </div>
        <div className="light-stage mob">
          <StagePhoto photo={cur} alt={alt} icon={52} />
          {nav}
        </div>
        {strip}
        <div className="light-sheet">
          {scrollBody}
          {commentBar}
        </div>
      </div>
    );
  }

  return (
    <div className="light-overlay" onClick={onClose}>
      <div className="light-card" ref={boxRef} role="dialog" aria-modal="true"
        aria-label="사진 크게 보기" onClick={(ev) => ev.stopPropagation()}>
        <div className="light-stage">
          <StagePhoto photo={cur} alt={alt} icon={64} />
          <span className="light-counter">{counter}</span>
          {nav}
          {strip}
        </div>
        <div className="light-panel">
          <div className="light-head">
            <Avatar m={author} size={34} />
            <div className="light-who">
              <div className="light-nm">{author.name}</div>
              <div className="light-when">{when}</div>
            </div>
            <button className="icon-btn light-close" ref={closeRef} aria-label="닫기" onClick={onClose}>
              <Icon d={X_D} size={16} sw={2.4} />
            </button>
          </div>
          {scrollBody}
          {commentBar}
        </div>
      </div>
    </div>
  );
}
