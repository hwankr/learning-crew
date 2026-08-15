/* 라운지 — 공부 기록이 아닌 자유 글(사진+텍스트)의 카드·작성·확대·삭제 조각들.
   별도 탭이 아니라 피드 안에 산다: 자유 글은 "가끔" 올라오는 것이라 전용 탭은 텅 비기
   쉽고, 모두가 이미 보는 피드에 실려야 읽힌다(Feed.tsx가 날짜 묶음에 섞어 그린다).
   디자인 원본(라운지.dc.html): 별점도 태그도 없다. 수정도 없다 — 글은 올리거나 지울 뿐이다.
   댓글 조각(CommentList/CommentForm)은 기록 카드와 같은 것을 쓴다 — 여기서 단 댓글의
   모양·IME 규칙이 피드와 달라질 이유가 없다. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EntryPhoto, MemberId, Post, PostComment } from '../../shared/types';
import { ENTRY_PHOTO_LIMIT, PUSH_LIMITS } from '../../shared/types';
import { memberOf, pad2, type CopySet } from '../lib/constants';
import { photoStatusOf } from '../lib/photos';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useOnline } from '../lib/useOnline';
import type { DurableStorageState, PhotoUploadInfo } from '../local/store';
import { Avatar, CameraIcon, Icon, LEFT_D, RIGHT_D, X_D } from './icons';
import { CommentList, CommentForm } from './EntrySocial';
import { photoStorageNotice } from './EntryModal';
import { PhotoImg } from './PhotoImg';
import { StagePhoto, lightboxKeyAction } from './PhotoLightbox';

/** 글 시각 — "오늘 07:41 · 어제 21:05 · 8월 3일 09:10". 피드는 날짜 묶음이 있어 시각만
    쓰지만, 라운지는 한 줄 목록이라 글마다 날짜 맥락을 함께 쓴다(디자인). */
export function postWhen(createdAt: string, todayKey: string, yKey: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (key === todayKey) return `오늘 ${hm}`;
  if (key === yKey) return `어제 ${hm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

/** 접어 보여줄 만큼 긴 글인가 — 3줄 클램프 + "더 보기"의 문턱(디자인 원본의 판정 그대로). */
export function postIsLong(body: string): boolean {
  return body.length > 76 || body.includes('\n');
}

export interface LoungeActions {
  onCompose: () => void;
  onDelete: (post: Post) => void;
  onAddComment: (postId: string, body: string) => void;
  onDeleteComment: (id: string) => void;
  onOpenPhoto: (post: Post, photoId: string) => void;
  /** 실패한 사진의 유일한 탈출구 — 업로드 큐는 fail을 스스로 재시도하지 않는다. */
  onRetryPhoto: (photoId: string) => boolean;
}

/** 캐러셀의 지금 장 — 프레임 폭은 CSS(데스크톱 268/모바일 238)가 정하므로 실제 폭을 잰다. */
export function carouselIndex(scrollLeft: number, frameWidth: number, count: number): number {
  if (frameWidth <= 0) return 0;
  // gap 8px은 스타일과 약속된 값 — 프레임+간격 단위로 반올림한다
  return Math.min(Math.max(Math.round(scrollLeft / (frameWidth + 8)), 0), count - 1);
}

export function PostCard({
  post, comments, meId, live, photoUploads, wit, actions,
}: {
  post: Post;
  comments: PostComment[];
  meId: MemberId;
  /** 작성자가 지금 공부 중인가 — 이름 옆 초록 점(크루 패널과 같은 판정) */
  live: boolean;
  /** 이 기기가 올리는 내 사진의 상태 — 크게 보기 가능 여부·실패 재시도가 이 값을 본다 */
  photoUploads: Map<string, PhotoUploadInfo>;
  wit: CopySet;
  actions: LoungeActions;
}) {
  const author = memberOf(post.m);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const long = postIsLong(post.body);
  const photos = post.photos;
  // 날짜 맥락은 피드의 날짜 묶음 머리가 말한다 — 카드는 기록 카드처럼 시각만 쓴다
  const at = new Date(post.createdAt);
  const hm = Number.isNaN(at.getTime()) ? '' : `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;

  return (
    <article className="post-card">
      <Avatar m={author} size={40} />
      <div className="post-main">
        <div className="post-head">
          <span className="post-name">{author.name}</span>
          <span className="post-when">{hm}</span>
          {/* 일기 형식의 기록 카드와 한 스트림에 섞이므로 종류를 칩으로 밝힌다 —
              기록 카드의 태그 칩 자리와 같은 문법이라 훑어볼 때 바로 갈린다 */}
          <span className="post-kind">라운지</span>
          {live && <span className="live-dot" aria-label="지금 공부 중" />}
          <span className="spacer" />
          {post.m === meId && (
            <button className="post-del" onClick={() => actions.onDelete(post)}>삭제</button>
          )}
        </div>
        {post.body && (
          <div className={'post-body' + (long && !open ? ' clamp' : '')}>{post.body}</div>
        )}
        {long && (
          <button className="post-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? '접기' : '더 보기'}
          </button>
        )}
        {photos.length > 0 && (
          <>
            <div
              className="post-carousel hs"
              onScroll={(ev) => {
                const el = ev.currentTarget;
                const w = (el.firstElementChild as HTMLElement | null)?.clientWidth ?? 0;
                const next = carouselIndex(el.scrollLeft, w, photos.length);
                if (next !== idx) setIdx(next);
              }}
            >
              {photos.map((p, i) => {
                // 프레임이 268px(DPR 2에서 536px)라 썸네일(긴 변 400px)은 눈에 띄게 흐리다 —
                // 모자이크의 1~2장 칸과 같은 이유로 표시용 원본을 받는다(뷰포트 게이트가 비용을 막는다)
                const img = <PhotoImg photoId={p.id} kind="full" preview="thumb" alt="" icon={22} />;
                const badge = photos.length > 1 && i === 0 && (
                  <span className="post-count-badge">{photos.length}장</span>
                );
                /* 아직 안 올라간 내 사진은 라이트박스 목록(shownPhotos)에 없다 — 크게 보기
                   버튼이면 눌러도 무반응이거나 다른 사진으로 점프한다. 올라가는 중은 자리만
                   보여 주고, 실패는 이 프레임이 재시도의 유일한 입구가 된다. */
                const st = photoStatusOf(p.id, post.m === meId, photoUploads);
                if (st.state === 'fail') {
                  return (
                    <button key={p.id} className="post-frame"
                      aria-label={`사진 ${i + 1} 업로드 실패 — 다시 시도`}
                      onClick={() => actions.onRetryPhoto(p.id)}>
                      {img}
                      {badge}
                      <span className="post-photo-state fail">실패 — 다시 시도</span>
                    </button>
                  );
                }
                if (st.state !== 'done') {
                  return (
                    <span key={p.id} className="post-frame still" role="img"
                      aria-label={`사진 ${i + 1} 올리는 중`}>
                      {img}
                      {badge}
                      <span className="post-photo-state">올리는 중…</span>
                    </span>
                  );
                }
                return (
                  <button key={p.id} className="post-frame"
                    aria-label={`${author.name}의 사진 ${i + 1} 크게 보기`}
                    onClick={() => actions.onOpenPhoto(post, p.id)}>
                    {img}
                    {badge}
                  </button>
                );
              })}
            </div>
            {photos.length > 1 && (
              <div className="post-dots" aria-hidden="true">
                {photos.map((p, i) => (
                  <span key={p.id} className={'post-dot' + (i === idx ? ' on' : '')} />
                ))}
              </div>
            )}
          </>
        )}
        <div className="post-social">
          <CommentList comments={comments} meId={meId} onDelete={actions.onDeleteComment} />
          <CommentForm meId={meId} onSubmit={(body) => actions.onAddComment(post.id, body)} />
        </div>
      </div>
    </article>
  );
}

/** 자유 글의 입구 — 피드 맨 위에 항상 보이는 초대장. 이름("아무거나")이 곧 모드 선택이라
    작성 시트 안에서 기록/자유글을 고르게 하지 않는다(기록 입구는 CTA/FAB가 따로 맡는다). */
export function LoungeComposerRow({
  meId, wit, onCompose,
}: {
  meId: MemberId;
  wit: CopySet;
  onCompose: () => void;
}) {
  const me = memberOf(meId);
  return (
    <button className="lounge-composer" onClick={onCompose}>
      <Avatar m={me} size={28} />
      <span className="lounge-composer-ph">{wit.loungePh}</span>
    </button>
  );
}

/* ---------- 작성 시트 ---------- */

export interface LoungeDraft {
  open: boolean;
  /** 사진 스테이징 키 — 저장될 Post id와 같다(기록 시트의 entryId와 같은 규칙). */
  postId: string;
  body: string;
  photos: EntryPhoto[];
}

export const EMPTY_LOUNGE_DRAFT: LoungeDraft = { open: false, postId: '', body: '', photos: [] };

/** 올릴 수 있는가 — 본문 또는 사진 중 하나(서버 검증과 같은 규칙). */
export function loungeCanSubmit(d: { body: string; photos: EntryPhoto[] }): boolean {
  return d.body.trim().length > 0 || d.photos.length > 0;
}

export function LoungeComposer({
  draft, preparing, demo, durableStorage, wit, fallbackRef,
  onBody, onAddFiles, onRemovePhoto, onClose, onSubmit,
}: {
  draft: LoungeDraft;
  preparing: boolean;
  demo: boolean;
  /** 기록 시트와 같은 보호 — 메모리 폴백에서는 사진이 유일본이라 안내·차단이 필요하다 */
  durableStorage: DurableStorageState;
  wit: CopySet;
  fallbackRef: RefObject<HTMLElement | null>;
  onBody: (body: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const online = useOnline();
  useFocusTrap(sheetRef, fallbackRef);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const full = draft.photos.length >= ENTRY_PHOTO_LIMIT;
  const ready = loungeCanSubmit(draft);
  const photoNotice = photoStorageNotice({
    durableStorage,
    online,
    demo,
    full,
    hasPhotos: draft.photos.length > 0 || preparing,
  });
  return (
    <div className="overlay compose-overlay" onClick={onClose}>
      <div className="sheet lounge-sheet" ref={sheetRef} role="dialog" aria-modal="true"
        aria-label={wit.loungeCta} onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head-row">
          <h2 className="sheet-title">{wit.loungeCta}</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="닫기">
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        <div className="lounge-sheet-sub">{wit.loungeComposeSub}</div>

        <div className="sheet-label-row">
          <span className="sheet-label">사진</span>
          <span className={'photo-count' + (full ? ' full' : '')}>
            {draft.photos.length}/{ENTRY_PHOTO_LIMIT}
          </span>
        </div>
        {/* 기록 시트의 5열 유동 격자 대신 디자인 원본의 고정 84px 타일 + 보이는 라벨 */}
        <div className="lounge-photo-grid">
          {draft.photos.map((p, i) => (
            <span className="lounge-photo-tile" key={p.id}>
              <PhotoImg photoId={p.id} kind="thumb" alt={`첨부한 사진 ${i + 1}`} icon={20} immediate />
              <button className="photo-drop" aria-label="이 사진 빼기" onClick={() => onRemovePhoto(p.id)}>
                <Icon d={X_D} size={10} sw={3} />
              </button>
            </span>
          ))}
          <button className="lounge-photo-add" disabled={full || photoNotice.blocksAdd}
            onClick={() => fileRef.current?.click()}>
            <CameraIcon size={18} />
            <span>사진 추가</span>
          </button>
          <input ref={fileRef} className="photo-file" type="file" accept="image/*" multiple
            tabIndex={-1} aria-hidden="true"
            onChange={(ev) => {
              const files = [...(ev.target.files ?? [])];
              // 같은 파일을 빼고 다시 골라도 change가 오도록 비운다
              ev.target.value = '';
              if (files.length) onAddFiles(files);
            }} />
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

        <label className="sheet-label" htmlFor="lounge-body">이야기</label>
        <textarea id="lounge-body" className="modal-diary" value={draft.body}
          placeholder={wit.loungeBodyPh} maxLength={PUSH_LIMITS.postBody} autoFocus
          onChange={(ev) => onBody(ev.target.value)} />

        <div className="sheet-foot">
          <span className="draft-note" role="status" aria-live="polite">
            {preparing ? '사진 준비 중…'
              : draft.photos.length ? `사진 ${draft.photos.length}장` : wit.loungeNoPhotoHint}
          </span>
          <button className="cancel-btn" onClick={onClose}>취소</button>
          <button className={'submit' + (ready ? ' ready' : '')} aria-disabled={!ready}
            aria-busy={preparing}
            onClick={() => { if (ready) onSubmit(); }}>
            올리기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 사진 확대 (라운지판 — 소셜 패널 없는 어두운 무대) ---------- */

export function LoungeLightbox({
  post, photos, index, onIndex, onClose, todayKey, yKey, fallbackRef,
}: {
  post: Post;
  /** 크게 볼 수 있는 사진만 (shownPhotos) — 비어 있으면 App이 아예 열지 않는다 */
  photos: EntryPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  todayKey: string;
  yKey: string;
  fallbackRef: RefObject<HTMLElement | null>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useFocusTrap(boxRef, fallbackRef);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const idx = Math.min(Math.max(index, 0), photos.length - 1);
  const author = memberOf(post.m);

  /* 버튼·키보드가 자리를 바꾸면 트랙을 그 페이지로 굴린다 — 스와이프가 바꾼 경우는
     이미 그 자리라 아무 일도 없다. 첫 렌더는 애니메이션 없이 곧장 그 장으로 연다. */
  useEffect(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 1) {
      el.scrollTo({ left: target, behavior: mounted.current ? 'smooth' : 'auto' });
    }
    mounted.current = true;
  }, [idx]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const action = lightboxKeyAction(ev.key, { pickerOpen: false, inField: false });
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
  }, [idx, photos.length, onClose, onIndex]);

  return (
    <div className="light-full" ref={boxRef} role="dialog" aria-modal="true" aria-label="사진 크게 보기">
      <div className="mlight-bar">
        <button className="mlight-close" ref={closeRef} aria-label="닫기" onClick={onClose}>
          <Icon d={X_D} size={16} sw={2.4} />
        </button>
        {photos.length > 1 && <span className="mlight-counter">{idx + 1} / {photos.length}</span>}
        <span className="spacer" />
        <span className="mlight-who">{author.name} · {postWhen(post.createdAt, todayKey, yKey)}</span>
      </div>
      <div className="light-stage">
        {/* 디자인 원본의 탐색은 스와이프다 — 페이지 트랙(scroll-snap)이 본체고,
            좌우 버튼·키보드는 같은 인덱스 상태를 통해 트랙을 굴린다 */}
        <div className="light-track" ref={trackRef}
          onScroll={(ev) => {
            const el = ev.currentTarget;
            if (el.clientWidth === 0) return;
            const next = Math.min(
              Math.max(Math.round(el.scrollLeft / el.clientWidth), 0),
              photos.length - 1,
            );
            if (next !== idx) onIndex(next);
          }}>
          {photos.map((p, i) => (
            <div className="light-page" key={p.id}>
              <StagePhoto photo={p} alt={`${author.name}의 라운지 사진 ${i + 1}`} icon={52} />
            </div>
          ))}
        </div>
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
      </div>
      {photos.length > 1 && (
        <div className="post-dots stage" aria-hidden="true">
          {photos.map((p, i) => (
            <span key={p.id} className={'post-dot' + (i === idx ? ' on' : '')} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 삭제 확인 ---------- */

/** 글 삭제 확인 — 기록의 ConfirmDelete와 같은 상자, 내용 카드 없이 디자인 문구만. */
export function LoungeConfirmDelete({
  wit, fallbackRef, onCancel, onConfirm,
}: {
  wit: CopySet;
  fallbackRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(boxRef, fallbackRef);

  // 기본 초점은 취소 — 열리자마자 누른 Enter가 곧바로 삭제로 이어지면 안 된다
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay confirm-overlay" onClick={onCancel}>
      <div className="confirm" ref={boxRef} role="dialog" aria-modal="true"
        aria-label={wit.loungeDelAsk} onClick={(ev) => ev.stopPropagation()}>
        <div className="confirm-title">{wit.loungeDelAsk}</div>
        <div className="confirm-note">{wit.loungeDelNote}</div>
        <div className="confirm-btns">
          <button className="confirm-btn cancel" ref={cancelRef} onClick={onCancel}>취소</button>
          <button className="confirm-btn danger" onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  );
}
