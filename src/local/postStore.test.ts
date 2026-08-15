/* 라운지 글·글 댓글의 스토어 수명 검증 — 댓글과 같은 "내용 불변 + soft delete" 규칙이
   글에도 정확히 적용되는지, 사진 소유 판정이 Entry뿐 아니라 Post도 보는지를 본다.
   (IDB 없는 메모리 전용 경로 — txWrite가 시작되지 않으면 메모리 기준으로 정산한다) */
import { describe, expect, it } from 'vitest';
import type { Post } from '../../shared/types';
import { CrewStore, sortPosts, groupPostComments } from './store';

const P1 = '11111111-1111-4111-8111-11111111111a';
const P2 = '11111111-1111-4111-8111-11111111111b';
const PH1 = '22222222-2222-4222-8222-22222222222a';

function serverEcho(store: CrewStore, id: string, over?: Partial<Post>): Post {
  const sent = store.pendingPosts().find((p) => p.id === id)!;
  return { ...sent, updatedAt: '2026-08-15T12:00:00.000Z', ...over };
}

describe('라운지 글 스토어 수명', () => {
  it('대문자 UUID는 소문자로 정규화해 저장한다 — pg가 소문자로 돌려주는 ACK·pull과 짝지어지게', () => {
    const store = new CrewStore();
    store.addPost({ id: P1.toUpperCase(), body: '글', photos: [] });
    expect(store.getSnapshot().posts[0]!.id).toBe(P1);
    expect(store.pendingPosts()[0]!.id).toBe(P1);
    store.addPostComment(P1.toUpperCase(), '댓글');
    expect(store.pendingPostComments()[0]!.postId).toBe(P1);
  });

  it('addPost는 즉시 스냅샷에 실리고(최신 먼저) 큐에 오르며, 빈 글은 무시된다', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '  도서관 가는 길  ', photos: [] });
    store.addPost({ id: P2, body: '', photos: [] }); // 본문도 사진도 없음 — 무시
    const snap = store.getSnapshot();
    expect(snap.posts.map((p) => p.id)).toEqual([P1]);
    expect(snap.posts[0]!.body).toBe('도서관 가는 길'); // 서버와 같은 trim — ACK 에코가 "변경"으로 안 보이게
    expect(store.pendingPosts().map((p) => p.id)).toEqual([P1]);
    expect(snap.sync.pending).toBe(1);
  });

  it('removePost는 내 글만 지우고, tombstone이 push 큐에 남는다', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '내 글', photos: [] });
    // 남의 글 흉내 — ackPost로 서버 행(다른 멤버)을 채택시킨다
    store.ackPost(store.pendingPosts()[0]!, serverEcho(store, P1));
    store.applyPull({
      rows: [], cursor: null,
      posts: [{ id: P2, m: 'wg', body: '남의 글', photos: [], createdAt: '2026-08-15T09:00:00.000Z', updatedAt: '2026-08-15T09:00:01.000Z', deletedAt: null }],
      postCursor: null, postComments: [], postCommentCursor: null,
    });
    store.removePost(P2); // 남의 글 — 무시
    expect(store.getSnapshot().posts).toHaveLength(2);

    store.removePost(P1);
    const snap = store.getSnapshot();
    expect(snap.posts.map((p) => p.id)).toEqual([P2]); // 화면에서는 사라진다
    const pending = store.pendingPosts();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.deletedAt).not.toBeNull(); // 삭제가 큐에 실려 서버로 간다
  });

  it('ackPost는 서버 행을 채택하고, 서버 tombstone은 로컬 행을 정리한다 (부활 없음)', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '글', photos: [] });
    const sent = store.pendingPosts()[0]!;
    store.ackPost(sent, serverEcho(store, P1));
    expect(store.pendingPosts()).toHaveLength(0);
    expect(store.getSnapshot().posts[0]!.updatedAt).toBe('2026-08-15T12:00:00.000Z');

    // 서버가 tombstone으로 강등한 응답(빈 글 가드) — 로컬 행이 지워지고 큐도 빈다
    store.addPost({ id: P2, body: '사진만 있던 글', photos: [] });
    const sent2 = store.pendingPosts()[0]!;
    store.ackPost(sent2, serverEcho(store, P2, { deletedAt: '2026-08-15T12:00:01.000Z' }));
    // 전송 중 삭제 상태가 바뀐 게 아니므로(보낸 것도 산 행, 저장된 것도 산 행) 정산된다
    expect(store.pendingPosts()).toHaveLength(0);
    expect(store.getSnapshot().posts.map((p) => p.id)).toEqual([P1]);
  });

  it('전송 중 삭제된 글의 live ACK는 큐를 지키고(hold), 삭제를 다음 라운드가 보낸다', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '글', photos: [] });
    const sent = store.pendingPosts()[0]!; // 살아 있는 행을 전송했다
    store.removePost(P1); // 전송 중 삭제
    store.ackPost(sent, serverEcho(store, P1)); // 살아 있는 서버 에코가 돌아옴
    const pending = store.pendingPosts();
    expect(pending).toHaveLength(1); // 삭제가 아직 안 갔다 — 큐 유지
    expect(pending[0]!.deletedAt).not.toBeNull();
  });

  it('applyPull은 내 큐가 이기고, 중복 전달을 무시하며, tombstone을 반영한다', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '아직 안 보낸 글', photos: [] });
    const row: Post = { id: P1, m: 'sh', body: '서버의 다른 내용', photos: [], createdAt: '2026-08-15T08:00:00.000Z', updatedAt: '2026-08-15T08:00:01.000Z', deletedAt: null };
    store.applyPull({ rows: [], cursor: null, posts: [row], postCursor: null });
    expect(store.getSnapshot().posts[0]!.body).toBe('아직 안 보낸 글'); // 큐 우선

    store.ackPost(store.pendingPosts()[0]!, serverEcho(store, P1));
    const dead: Post = { ...row, updatedAt: '2026-08-15T13:00:00.000Z', deletedAt: '2026-08-15T13:00:00.000Z' };
    store.applyPull({ rows: [], cursor: null, posts: [dead], postCursor: null });
    expect(store.getSnapshot().posts).toHaveLength(0); // 다른 기기의 삭제가 반영됐다
  });

  it('글 댓글은 (createdAt, id) 오름차순으로 묶이고, 삭제는 목록에서 빠진다', () => {
    const store = new CrewStore();
    store.addPost({ id: P1, body: '글', photos: [] });
    store.addPostComment(P1, '둘째 댓글');
    store.addPostComment(P1, '  ');
    const snap = store.getSnapshot();
    const comments = snap.postComments.get(P1) ?? [];
    expect(comments.map((c) => c.body)).toEqual(['둘째 댓글']); // 공백 댓글은 무시
    store.removePostComment(comments[0]!.id);
    expect(store.getSnapshot().postComments.get(P1)).toBeUndefined();
    // tombstone은 push 큐에 남는다
    expect(store.pendingPostComments().some((c) => c.deletedAt !== null)).toBe(true);
  });

  it('사진 소유 판정이 라운지 글도 본다 — 글에 첨부된 사진이 업로드 목록에 잡힌다', async () => {
    const store = new CrewStore();
    const prepared = { full: new Blob(['f']), thumb: new Blob(['t']), w: 800, h: 1000 };
    await store.addPreparedPhoto(P1, prepared, PH1);
    // 아직 소유 행이 없다 — 초안 사진은 업로드 큐 대상이 아니다(취소한 초안의 orphan 방지)
    expect(store.listPhotoUploads()).toHaveLength(0);
    store.addPost({ id: P1, body: '', photos: [{ id: PH1, w: 800, h: 1000 }] });
    // Post에 실리는 순간 photoIsAttached가 posts 맵에서 소유자를 찾아 큐 대상이 된다
    expect(store.listPhotoUploads().map((u) => u.id)).toEqual([PH1]);
    store.removePost(P1);
    expect(store.listPhotoUploads()).toHaveLength(0); // 삭제된 글의 사진은 첨부가 아니다
  });
});

describe('스냅샷 정렬 헬퍼', () => {
  it('sortPosts는 최신 먼저, 같은 시각이면 id 내림차순', () => {
    const p = (id: string, at: string): Post => ({ id, m: 'sh', body: 'x', photos: [], createdAt: at, updatedAt: at, deletedAt: null });
    const out = sortPosts([p('a', '2026-08-15T01:00:00.000Z'), p('b', '2026-08-15T02:00:00.000Z'), p('c', '2026-08-15T01:00:00.000Z')]);
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('groupPostComments는 postId로 묶고 오래된 것부터', () => {
    const c = (id: string, postId: string, at: string) => ({ id, postId, m: 'sh' as const, body: 'x', createdAt: at, updatedAt: at, deletedAt: null });
    const out = groupPostComments([c('y', 'p', '2026-08-15T02:00:00.000Z'), c('x', 'p', '2026-08-15T01:00:00.000Z')]);
    expect((out.get('p') ?? []).map((v) => v.id)).toEqual(['x', 'y']);
  });
});
