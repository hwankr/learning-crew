/* 백그라운드 동기화 클라이언트.
   - push: 큐에 쌓인 내 행들을 버전 CAS 업서트로 전송 (실패하면 큐에 남아 재시도)
   - pull: (updated_at, id) 키셋 커서 이후 변경분만 수신
   - 세 스트림(기록·댓글·리액션)은 커서가 서로 독립이지만 요청은 함께 실어 왕복을 아낀다
   - 탭이 보일 때만 폴링 — Neon 무료 컴퓨트를 아끼고, 안 보이는 탭은 조용히 둔다 */
import type {
  Comment,
  Entry,
  MemberId,
  PullResponse,
  PushRequest,
  PushResponse,
  ReactionSet,
  StatusSetRequest,
  StatusSetResponse,
  TagPrefsPutRequest,
  TagPrefsPutResponse,
  TagPrefsResponse,
} from '../../shared/types';
import { PUSH_LIMITS } from '../../shared/types';
import { authHeaders } from '../lib/push';
import { rearmMissingPhotosAfterPull } from '../lib/usePhoto';
import { reactionKey } from './idb';
import type { CrewStore } from './store';

const POLL_MS = 20_000;
// 서버 pull 한 페이지 크기 — 가득 찬 페이지는 "더 있다"는 뜻이다
const PAGE = 500;
// 응답 없는 요청이 busy 플래그를 영원히 잠그지 않게 — 브라우저 fetch에는 기본 타임아웃이 없다
const FETCH_TIMEOUT_MS = 20_000;

/** 401 — 토큰 만료/서명 키 교체. 재시도해도 소용없고 재로그인이 필요하다. */
class AuthError extends Error {}

function ensureOk(res: Response, what: string): void {
  if (res.status === 401) throw new AuthError(`${what} 401`);
  if (!res.ok) throw new Error(`${what} ${res.status}`);
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    : undefined;
}

export class SyncClient {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  // stop()에서 떼어낼 수 있게 핸들러를 보관한다
  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      // 다른 탭이 그동안 pull한 결과가 IDB에만 있을 수 있다(공유 커서) — 먼저 재적재
      void this.store.refreshFromDB();
      void this.cycle();
    }
  };
  private onOnline = (): void => void this.cycle();
  private onOffline = (): void => this.store.setSyncPhase('offline');

  constructor(
    private store: CrewStore,
    private token: string,
    private memberId: MemberId,
  ) {}

  start(): void {
    this.store.onLocalWrite = () => this.schedulePush();
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.cycle();
    }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    if (!navigator.onLine) this.store.setSyncPhase('offline');
    void this.cycle();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.store.onLocalWrite = null;
  }

  /** 쓰기 직후 짧게 모아서 push (연타 시 batch). */
  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.cycle(), 400);
  }

  /** push(큐가 있으면) → pull 한 사이클. 동시 실행은 막는다. */
  private async cycle(): Promise<void> {
    if (this.busy) return;
    if (!navigator.onLine) {
      this.store.setSyncPhase('offline');
      return;
    }
    this.busy = true;
    try {
      await this.push();
      await this.pushStatus();
      await this.syncTagPrefs();
      await this.pull();
      this.store.setSyncPhase('ok');
      // 충돌 병합/전송 중 재수정으로 큐가 남았으면 곧바로 다음 라운드를 예약한다.
      // 기록 큐만 보면 전송 중에 지운 댓글·다시 토글한 리액션이 20초 폴링까지 밀리므로
      // 세 큐 + 상태 dirty를 합산한 스냅샷의 pending으로 판정한다.
      // (pendingComments()/pendingReactions()는 고아 키를 정리하는 부수효과가 있어
      //  판정용으로 부르면 의미가 흐려진다 — 읽기 전용인 스냅샷을 쓴다)
      if (this.store.getSnapshot().sync.pending > 0) this.schedulePush();
    } catch (err) {
      // 큐와 커서가 남아 있으니 다음 사이클에 재시도 — 상태만 UI에 알린다
      this.store.setSyncPhase(
        err instanceof AuthError ? 'auth' : navigator.onLine ? 'error' : 'offline',
      );
    } finally {
      this.busy = false;
    }
  }

  private async push(): Promise<void> {
    const pending = this.store.pendingSnapshot();
    const rows: { entry: Entry; rev: number }[] = [];
    for (const p of pending) {
      if (p.entry.m !== this.memberId) {
        this.store.dropFromQueue(p.entry.id); // 내 행이 아니면 서버가 거부 — 큐를 오염시키지 않는다
        continue;
      }
      rows.push(p);
    }
    const comments: Comment[] = [];
    for (const c of this.store.pendingComments()) {
      if (c.m !== this.memberId) this.store.dropCommentFromQueue(c.id);
      else comments.push(c);
    }
    const reactions: ReactionSet[] = [];
    for (const r of this.store.pendingReactions()) {
      if (r.m !== this.memberId) this.store.dropReactionFromQueue(r.entryId);
      else reactions.push(r);
    }
    const reads = this.store.pendingNotificationReads();
    const B = PUSH_LIMITS.batch;
    // 네 스트림을 각자 배치로 쪼개 한 요청에 함께 싣는다 — 라운드 수는 가장 긴 스트림 기준
    const rounds = Math.max(
      Math.ceil(rows.length / B),
      Math.ceil(comments.length / B),
      Math.ceil(reactions.length / B),
      Math.ceil(reads.length / B),
    );
    for (let i = 0; i < rounds; i++) {
      const batch = rows.slice(i * B, i * B + B);
      const cBatch = comments.slice(i * B, i * B + B);
      const rBatch = reactions.slice(i * B, i * B + B);
      const nBatch = reads.slice(i * B, i * B + B);
      const revById = new Map(batch.map((p) => [p.entry.id, p.rev]));
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: authHeaders(this.token),
        body: JSON.stringify({
          entries: batch.map((p) => p.entry),
          comments: cBatch,
          reactions: rBatch,
          notificationReads: nBatch,
        } satisfies PushRequest),
        signal: timeoutSignal(),
      });
      ensureOk(res, 'push');
      const data = (await res.json()) as PushResponse;
      if (Array.isArray(data.results)) {
        for (const r of data.results) {
          const rev = revById.get(r.id);
          if (rev === undefined) continue; // 내가 보낸 행이 아니면 무시
          if (r.applied) this.store.ackApplied(r.id, rev, r.row);
          else this.store.resolveConflict(r.id, r.row);
        }
      } else if (batch.length === 0) {
        // 보낸 기록이 없으면 결과 배열이 없어도 정산할 게 없다
      } else if (data && data.ok === true && typeof data.serverTime === 'string') {
        // 배포 이행기의 구버전 Worker(LWW) 응답 — 전량 반영됐으므로 보낸 내용을 에코로 ACK.
        // (ACK하지 않으면 큐가 안 비어 400ms 재전송 루프가 된다)
        // ok/serverTime을 반드시 확인한다: 캐티브 포털 등 "가짜 200 JSON"에 큐를 비우면 안 된다.
        for (const p of batch) {
          this.store.ackApplied(p.entry.id, p.rev, { ...p.entry, updatedAt: data.serverTime });
        }
      } else {
        throw new Error('push malformed response');
      }
      // 보냈는데 결과 필드가 없으면 구버전 Worker가 통째로 무시한 것 — 큐를 비우면 조용히 유실된다.
      // 오류를 던져 이 사이클을 끝내면 20초 폴링이 재시도한다(400ms 재전송 루프에 빠지지 않게).
      if (cBatch.length > 0) {
        if (!Array.isArray(data.commentResults)) throw new Error('push comment results missing');
        const sent = new Map(cBatch.map((c) => [c.id, c]));
        for (const r of data.commentResults) {
          const mine = sent.get(r.id);
          if (mine) this.store.ackComment(mine, r.row);
        }
      }
      if (rBatch.length > 0) {
        if (!Array.isArray(data.reactionResults)) throw new Error('push reaction results missing');
        const sent = new Map(rBatch.map((r) => [reactionKey(r.entryId, r.m), r]));
        for (const r of data.reactionResults) {
          const mine = sent.get(reactionKey(r.entryId, r.m));
          if (mine) this.store.ackReaction(mine, r.row);
        }
      }
      if (nBatch.length > 0) {
        // 같은 규약 — 보냈는데 결과 필드가 없으면 구버전 Worker의 무시다. 큐를 지키고 재시도.
        if (!Array.isArray(data.notificationReadResults)) {
          throw new Error('push notification read results missing');
        }
        const settled = new Set(data.notificationReadResults);
        this.store.ackNotificationReads(nBatch.filter((r) => settled.has(r.id)));
      }
    }
  }

  /** 아직 서버에 안 간 내 지금 상태를 전송. 실패하면 dirty로 남아 다음 사이클에 재시도.
      액션 시각(at)을 실어 보내 서버가 도착 순서가 아니라 토글한 순서로 LWW 판정한다 —
      거부되면(다른 기기의 더 새 액션) 응답의 서버 상태를 그대로 채택한다. */
  private async pushStatus(): Promise<void> {
    const st = this.store.myStatusPending();
    if (!st) return;
    const res = await fetch('/api/sync/status', {
      method: 'POST',
      headers: authHeaders(this.token),
      body: JSON.stringify({
        on: st.on,
        place: st.place ?? undefined,
        since: st.since ?? undefined,
        at: st.updatedAt,
      } satisfies StatusSetRequest),
      signal: timeoutSignal(),
    });
    ensureOk(res, 'status');
    const data = (await res.json()) as StatusSetResponse;
    this.store.ackStatus(st.updatedAt, data.status);
  }

  /** 태그 설정은 별도 범용 큐 대신 캐시 + dirty 플래그 하나만 쓴다.
      dirty면 PUT 응답이 LWW 병합까지 대신하고, clean이면 GET으로 다른 기기의
      더 새 액션을 받는다. 실패하면 dirty가 그대로여서 online·가시화·다음 poll이 재시도한다. */
  private async syncTagPrefs(): Promise<void> {
    const pending = this.store.myTagPrefsPending();
    if (pending) {
      const res = await fetch('/api/tags/prefs', {
        method: 'PUT',
        headers: authHeaders(this.token),
        body: JSON.stringify({
          tags: pending.tags,
          at: pending.updatedAt,
        } satisfies TagPrefsPutRequest),
        signal: timeoutSignal(),
      });
      ensureOk(res, 'tag prefs put');
      const data = (await res.json()) as TagPrefsPutResponse;
      if (
        !data ||
        data.ok !== true ||
        typeof data.applied !== 'boolean' ||
        !this.store.ackTagPrefs(pending.updatedAt, data.prefs, data.applied)
      ) {
        throw new Error('tag prefs put malformed response');
      }
      return;
    }

    const res = await fetch('/api/tags/prefs', {
      headers: authHeaders(this.token),
      signal: timeoutSignal(),
    });
    ensureOk(res, 'tag prefs get');
    const data = (await res.json()) as TagPrefsResponse;
    if (!data || data.ok !== true || !this.store.mergeTagPrefsFromGet(data.prefs)) {
      throw new Error('tag prefs get malformed response');
    }
  }

  private async pull(): Promise<void> {
    const start = await this.store.getCursors();
    let cursor = start.entries;
    let cCursor = start.comments;
    let rCursor = start.reactions;
    let nCursor = start.notifications;
    let adoptedEntryMetadata = false;
    // 500행 한도에 걸렸을 수 있으니 네 스트림이 다 비워질 때까지 반복
    for (;;) {
      const qs = new URLSearchParams();
      if (cursor) {
        qs.set('since', cursor.ts);
        qs.set('sinceId', cursor.id);
      }
      if (cCursor) {
        qs.set('csince', cCursor.ts);
        qs.set('csinceId', cCursor.id);
      }
      if (rCursor) {
        // 지평선 커서의 m은 빈 문자열일 수 있다 — 서버는 rsinceM의 "존재"로 판단하므로
        // 값이 ''이어도 파라미터를 붙여야 그 스트림이 매번 처음부터 돌지 않는다
        qs.set('rsince', rCursor.ts);
        qs.set('rsinceEntry', rCursor.entryId);
        qs.set('rsinceM', rCursor.m);
      }
      if (nCursor) {
        qs.set('nsince', nCursor.ts);
        qs.set('nsinceId', nCursor.id);
      }
      const q = qs.toString();
      const res = await fetch(`/api/sync/pull${q ? `?${q}` : ''}`, {
        headers: authHeaders(this.token),
        signal: timeoutSignal(),
      });
      ensureOk(res, 'pull');
      const data = (await res.json()) as PullResponse;
      // 응답에 필드가 아예 없으면 구버전 Worker다 — 그 스트림은 없는 것으로 보고 커서도 안 건드린다.
      // 알림은 커서 필드까지 함께 있어야 산 스트림으로 본다: 행만 있고 커서가 없는 반쪽 응답을
      // 믿으면 커서가 영영 전진하지 못해 500행 페이지에서 같은 페이지를 무한 반복한다.
      const cRows = Array.isArray(data.comments) ? data.comments : undefined;
      const rRows = Array.isArray(data.reactions) ? data.reactions : undefined;
      const nRows =
        Array.isArray(data.notifications) && 'notificationCursor' in data
          ? data.notifications
          : undefined;
      const eFull = data.rows.length >= PAGE;
      const cFull = (cRows?.length ?? 0) >= PAGE;
      const rFull = (rRows?.length ?? 0) >= PAGE;
      const nFull = (nRows?.length ?? 0) >= PAGE;
      // 행 반영과 커서 전진을 스토어가 한 트랜잭션으로 처리한다.
      // 중간 페이지(=500행)인 스트림은 이전 커서를 영속화한다 — 페이지 사이에서 탭이 죽으면
      // 다시 받으면 그만이지만(중복은 updatedAt으로 무시), 전진한 커서가 지평선 너머로
      // 영속화된 채 방치되면 늦게 커밋된 행을 영영 놓칠 수 있다.
      const pageAdoptedEntryMetadata = this.store.applyPull({
        rows: data.rows,
        cursor: eFull ? cursor : data.cursor,
        statuses: Array.isArray(data.statuses) ? data.statuses : undefined,
        comments: cRows,
        commentCursor: cRows && (cFull ? cCursor : (data.commentCursor ?? null)),
        reactions: rRows,
        reactionCursor: rRows && (rFull ? rCursor : (data.reactionCursor ?? null)),
        notifications: nRows,
        notificationCursor: nRows && (nFull ? nCursor : (data.notificationCursor ?? null)),
      });
      adoptedEntryMetadata ||= pageAdoptedEntryMetadata;
      if (data.cursor) cursor = data.cursor;
      if (data.commentCursor) cCursor = data.commentCursor;
      if (data.reactionCursor) rCursor = data.reactionCursor;
      if (data.notificationCursor) nCursor = data.notificationCursor;
      if (!eFull && !cFull && !rFull && !nFull) break;
    }
    // 서버 안전 지평선이 같은 행을 되돌려도 store가 실제 새 메타를 채택하지 않았으면
    // 같은 404 예산을 다시 열지 않는다.
    if (adoptedEntryMetadata) rearmMissingPhotosAfterPull();
  }
}
