import type { Comment, Entry, MemberId, ReactionEmoji, ReactionSet } from '../../shared/types';
import { entryTags, isOffTags } from '../../shared/types';
import { memberOf } from '../lib/constants';
import { mosaicArea, mosaicGrid, mosaicPhotoKind, photoStatusOf, shownPhotos } from '../lib/photos';
import type { PhotoUploadInfo } from '../local/store';
import { Avatar, BANG_D, CheckMark, ClockIcon, Icon, StarsRow } from './icons';
import { Chip, MoreChip } from './Chip';
import { EntrySocial } from './EntrySocial';
import { PhotoImg } from './PhotoImg';

/** 컴팩트 카드의 한 줄 머리에 들어갈 칩 개수 — 나머지는 +N으로 접는다.
    이름·시각·별점과 한 줄을 나눠 써야 해서 태그가 자리를 다 먹으면 안 된다. */
const COMPACT_CHIPS = 2;

export interface EntryActions {
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onToggleTodo: (e: Entry, index: number) => void;
  onAddComment: (entryId: string, body: string) => void;
  onDeleteComment: (id: string) => void;
  onToggleReaction: (entryId: string, emoji: ReactionEmoji) => void;
  /** 누른 사진 자체를 넘긴다 — 숫자 자리로 넘기면 라이트박스가 열려 있는 동안 앞쪽
      사진이 done이 되었을 때 같은 자리가 다른 사진을 가리킨다. */
  onOpenPhoto: (e: Entry, photoId: string) => void;
  onRetryPhoto: (photoId: string) => void;
}

/** 미완료 배지의 한 줄 — 상태가 곧 문구다. */
const PHOTO_NOTE = { up: '올리는 중', fail: '재시도', wait: '대기', done: '' } as const;

export function EntryCard({
  e, compact, mine, meId, editing, comments, reactions, photoUploads, actions,
}: {
  e: Entry;
  compact: boolean;
  mine: boolean;
  meId: MemberId;
  editing: boolean;
  comments: Comment[];
  reactions: ReactionSet[];
  /** 내 사진의 이 기기 업로드 상태 — 배지는 본인 화면에만 뜬다 */
  photoUploads: Map<string, PhotoUploadInfo>;
  actions: EntryActions;
}) {
  // 모르는 멤버 id는 중립 표시로 — 구버전 번들이 새 멤버의 기록을 남의 이름으로 붙이면 안 된다
  const mm = memberOf(e.m);
  // 구버전 IDB 행(tags 없음)도 대표 태그에서 되살아난다 — 항상 1개 이상이다
  const tags = entryTags(e);
  const hasStars = !isOffTags(tags) && (e.stars ?? 0) > 0;
  const doneN = e.todos.filter((t) => t.done).length;
  const photoN = e.photos.length;
  // 라이트박스에 세울 수 있는 사진 — 여기서의 자리(index)가 곧 라이트박스의 자리다
  const shown = shownPhotos(e.photos, mine, photoUploads);
  // 모자이크 칸 크기는 장수가 정한다 — 큰 칸(1~2장)만 표시용 원본을 받는다
  const mosaicKind = mosaicPhotoKind(photoN);

  return (
    <div className={'entry' + (compact ? ' compact' : '') + (editing ? ' editing' : '')}>
      <Avatar m={mm} size={compact ? 32 : 40} />
      <div className="entry-main">
        <div className="entry-head">
          <span className="entry-name">{mm.name}</span>
          <span className="entry-time">{e.time}</span>
          {/* 컴팩트(캘린더)는 태그·별점 줄이 따로 없어 머리에 붙인다 (넓은 모드는
              수정·삭제가 margin-left:auto로 밀려나므로 빈 칸이 필요 없다) */}
          {compact && (
            <>
              <span className="spacer" />
              {/* 좁은 한 줄 — 앞의 두 개만 보여 주고 나머지는 +N으로 접는다 */}
              <span className="entry-head-tags">
                {tags.slice(0, COMPACT_CHIPS).map((t) => (
                  <Chip key={t} tag={t} variant="sm2" />
                ))}
                {tags.length > COMPACT_CHIPS && (
                  <MoreChip n={tags.length - COMPACT_CHIPS} variant="sm2" />
                )}
              </span>
              {hasStars && <StarsRow n={e.stars ?? 0} w={55} h={11} />}
            </>
          )}
          {/* 내 기록이면 어디서 보든(피드·캘린더) 고치고 지울 수 있다 */}
          {mine && (
            <div className="entry-actions">
              <button className="entry-act edit" onClick={() => actions.onEdit(e)}>수정</button>
              <button className="entry-act del" onClick={() => actions.onDelete(e)}>삭제</button>
            </div>
          )}
        </div>
        {!compact && (
          <div className="entry-tags">
            {/* 넓은 모드는 전부 보여 준다 — .entry-tags가 flex-wrap이라 줄바꿈이 자연스럽다 */}
            {tags.map((t) => (
              <Chip key={t} tag={t} variant="md" />
            ))}
            {hasStars && <StarsRow n={e.stars ?? 0} w={66} h={13} />}
            {e.todos.length > 0 && (
              <span className="todo-count">할 일 {doneN}/{e.todos.length}</span>
            )}
          </div>
        )}
        {e.memo && <div className="entry-memo">{e.memo}</div>}
        {/* 제목(memo)이 없으면 본문이 그 자리로 올라온다 — 한 줄짜리 기록이 회색 잔글씨로
            깔리지 않게 하는 디자인 규칙 */}
        {e.body && <div className={'entry-body' + (e.memo ? '' : ' lead')}>{e.body}</div>}
        {/* 넓은 카드는 모자이크, 컴팩트(캘린더 목록)는 한 장 미리보기 + 장수 — 좁은 열에
            모자이크를 그대로 넣으면 카드 하나가 목록 한 화면을 다 먹는다 */}
        {photoN > 0 && !compact && (
          <div className="photo-mosaic" style={mosaicGrid(photoN)}>
            {e.photos.map((p, i) => {
              const { state, pct } = photoStatusOf(p.id, mine, photoUploads);
              const failed = state === 'fail';
              const cell = (
                <>
                  {/* 원본을 기다리는 동안에는 이미 받아 둔 썸네일을 흐리게 깐다 —
                      라이트박스 무대와 같은 방식이라 새 상태를 만들지 않는다 */}
                  <PhotoImg photoId={p.id} kind={mosaicKind} alt="" icon={26}
                    preview={mosaicKind === 'full' ? 'thumb' : undefined}
                    iconColor="rgba(22,24,29,0.22)" iconSw={1.8} lens />
                  {/* 배지는 내 기기의 업로드 상태다 — 남의 화면에는 아예 뜨지 않는다 */}
                  {state !== 'done' && (
                    <span className="photo-badge">
                      {state === 'up' && (
                        <span className="photo-ring" style={{
                          background: `conic-gradient(#FFB800 ${pct}%, rgba(255,255,255,0.34) 0)`,
                        }}>
                          <span className="photo-pct">{pct}%</span>
                        </span>
                      )}
                      {failed && (
                        <span className="photo-mark fail">
                          <Icon d={BANG_D} size={16} sw={2.6} />
                        </span>
                      )}
                      {state === 'wait' && (
                        <span className="photo-mark wait"><ClockIcon size={17} /></span>
                      )}
                      <span className="photo-note">{PHOTO_NOTE[state]}</span>
                    </span>
                  )}
                </>
              );
              const area = { gridArea: mosaicArea(photoN, i) };
              /* 아직 올라가는 중이거나 대기 중인 사진은 눌러도 할 일이 없다 — 죽은 버튼
                 대신 상태와 진행률을 이름으로 읽는 자리로 둔다(실패는 재시도라 버튼이다) */
              if (state === 'up' || state === 'wait') {
                return (
                  <span key={p.id} className="photo-cell idle" style={area} role="img"
                    aria-label={`사진 ${photoN}장 중 ${i + 1}번째 — ${
                      state === 'up' ? `올리는 중 ${pct}%` : '올릴 차례를 기다리는 중'}`}>
                    {cell}
                  </span>
                );
              }
              return (
                <button
                  key={p.id}
                  className="photo-cell"
                  style={area}
                  aria-label={failed
                    ? '업로드 실패 — 다시 시도'
                    : `사진 ${photoN}장 중 ${i + 1}번째 크게 보기`}
                  onClick={() => {
                    if (failed) actions.onRetryPhoto(p.id);
                    else actions.onOpenPhoto(e, p.id);
                  }}
                >
                  {cell}
                </button>
              );
            })}
          </div>
        )}
        {/* 보이는 사진·열리는 사진·장수를 전부 done 기준으로 맞춘다 — 첫 장이 올라가는
            중일 때 그 사진을 보여 주면서 다른 사진을 여는 어긋남이 생기지 않게 */}
        {photoN > 0 && compact && (shown.length > 0 ? (
          <button
            className="photo-fill"
            aria-label={`사진 ${shown.length}장 크게 보기`}
            onClick={() => actions.onOpenPhoto(e, shown[0]!.id)}
          >
            <span className="photo-fill-thumb">
              <PhotoImg photoId={shown[0]!.id} kind="thumb" alt="" icon={18}
                iconColor="rgba(22,24,29,0.26)" />
              {shown.length > 1 && <span className="photo-fill-n">{shown.length}</span>}
            </span>
            <span className="photo-fill-text">사진 {shown.length}장</span>
          </button>
        ) : (
          /* 아직 크게 볼 수 있는 사진이 없다 — 열 것이 없으니 상태만 읽히는 자리로 둔다 */
          <span className="photo-fill idle" role="img"
            aria-label={`사진 ${photoN}장 · ${PHOTO_NOTE[photoStatusOf(e.photos[0]!.id, mine, photoUploads).state] || '올리는 중'}`}>
            <span className="photo-fill-thumb">
              <PhotoImg photoId={e.photos[0]!.id} kind="thumb" alt="" icon={18}
                iconColor="rgba(22,24,29,0.26)" />
              {photoN > 1 && <span className="photo-fill-n">{photoN}</span>}
            </span>
            <span className="photo-fill-text">사진 {photoN}장</span>
          </span>
        ))}
        {e.todos.length > 0 && (
          <div className="entry-todos">
            {e.todos.map((t, i) => (
              <div className="todo-line" key={i}>
                {mine ? (
                  <button
                    type="button"
                    className={'todo-check' + (t.done ? ' done' : '') + ' tappable'}
                    aria-label={`${t.t}: ${t.done ? '완료 해제' : '완료로 표시'}`}
                    aria-pressed={t.done}
                    onClick={() => actions.onToggleTodo(e, i)}
                  >
                    <CheckMark size={compact ? 10 : 11} />
                  </button>
                ) : (
                  // 남의 할 일은 조작할 수 없다 — 버튼으로 그리면 키보드에 아무 일도 안 하는 제어가 남는다
                  <span className={'todo-check' + (t.done ? ' done' : '')}
                    role="img" aria-label={t.done ? '완료' : '미완료'}>
                    <CheckMark size={compact ? 10 : 11} />
                  </span>
                )}
                <span className={'todo-text' + (t.done ? ' done' : '')}>{t.t}</span>
              </div>
            ))}
          </div>
        )}
        <EntrySocial entryId={e.id} comments={comments} sets={reactions} meId={meId} actions={actions} />
      </div>
    </div>
  );
}
