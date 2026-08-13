/* 백그라운드 동기화 클라이언트.
   - push: 큐에 쌓인 내 행들을 버전 CAS 업서트로 전송 (실패하면 큐에 남아 재시도)
   - pull: (updated_at, id) 키셋 커서 이후 변경분만 수신
   - 탭이 보일 때만 폴링 — Neon 무료 컴퓨트를 아끼고, 안 보이는 탭은 조용히 둔다 */
import type {
  Entry,
  MemberId,
  PullResponse,
  PushRequest,
  PushResponse,
  StatusSetRequest,
  StatusSetResponse,
} from '../../shared/types';
import { PUSH_LIMITS } from '../../shared/types';
import { authHeaders } from '../lib/push';
import type { CrewStore } from './store';

const POLL_MS = 20_000;
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
      await this.pull();
      this.store.setSyncPhase('ok');
      // 충돌 병합/전송 중 재수정으로 큐가 남았으면 곧바로 다음 라운드를 예약한다
      if (this.store.pendingIds().length > 0) this.schedulePush();
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
    for (let i = 0; i < rows.length; i += PUSH_LIMITS.batch) {
      const batch = rows.slice(i, i + PUSH_LIMITS.batch);
      const revById = new Map(batch.map((p) => [p.entry.id, p.rev]));
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: authHeaders(this.token),
        body: JSON.stringify({ entries: batch.map((p) => p.entry) } satisfies PushRequest),
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

  private async pull(): Promise<void> {
    let cursor = await this.store.getCursor();
    // 500행 한도에 걸렸을 수 있으니 다 받을 때까지 반복
    for (;;) {
      const qs = cursor ? `?since=${encodeURIComponent(cursor.ts)}&sinceId=${cursor.id}` : '';
      const res = await fetch(`/api/sync/pull${qs}`, {
        headers: authHeaders(this.token),
        signal: timeoutSignal(),
      });
      ensureOk(res, 'pull');
      const data = (await res.json()) as PullResponse;
      const lastPage = data.rows.length < 500;
      // 행 반영과 커서 전진을 스토어가 한 트랜잭션으로 처리한다.
      // 중간 페이지(=500행)에서는 이전 커서를 영속화한다 — 페이지 사이에서 탭이 죽으면
      // 다시 받으면 그만이지만(중복은 v로 무시), 전진한 커서가 지평선 너머로 영속화된 채
      // 방치되면 늦게 커밋된 행을 영영 놓칠 수 있다.
      this.store.applyPull(
        data.rows,
        Array.isArray(data.statuses) ? data.statuses : undefined,
        lastPage ? data.cursor : cursor,
      );
      if (data.cursor) cursor = data.cursor;
      if (lastPage) break;
    }
  }
}
