/* 백그라운드 동기화 클라이언트.
   - push: 큐에 쌓인 내 행들을 멱등 업서트로 전송 (실패하면 큐에 남아 재시도)
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
import type { CrewStore } from './store';

const POLL_MS = 20_000;

export class SyncClient {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.cycle();
    });
    window.addEventListener('online', () => void this.cycle());
    void this.cycle();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.store.onLocalWrite = null;
  }

  /** 쓰기 직후 짧게 모아서 push (연타 시 batch). */
  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.cycle(), 400);
  }

  /** push(큐가 있으면) → pull 한 사이클. 동시 실행은 막는다. */
  private async cycle(): Promise<void> {
    if (this.busy || !navigator.onLine) return;
    this.busy = true;
    try {
      await this.push();
      await this.pushStatus();
      await this.pull();
      // 충돌 병합/전송 중 재수정으로 큐가 남았으면 곧바로 다음 라운드를 예약한다
      if (this.store.pendingIds().length > 0) this.schedulePush();
    } catch {
      // 오프라인/서버 오류 — 큐와 커서가 남아 있으니 다음 사이클에 재시도
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
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ entries: batch.map((p) => p.entry) } satisfies PushRequest),
      });
      if (!res.ok) throw new Error(`push ${res.status}`);
      const data = (await res.json()) as PushResponse;
      for (const r of data.results ?? []) {
        const rev = revById.get(r.id);
        if (rev === undefined) continue; // 내가 보낸 행이 아니면 무시
        if (r.applied) this.store.ackApplied(r.id, rev, r.row);
        else this.store.resolveConflict(r.id, r.row);
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
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        on: st.on,
        place: st.place ?? undefined,
        since: st.since ?? undefined,
        at: st.updatedAt,
      } satisfies StatusSetRequest),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as StatusSetResponse;
    this.store.ackStatus(st.updatedAt, data.status);
  }

  private async pull(): Promise<void> {
    let cursor = await this.store.getCursor();
    // 500행 한도에 걸렸을 수 있으니 다 받을 때까지 반복
    for (;;) {
      const qs = cursor ? `?since=${encodeURIComponent(cursor.ts)}&sinceId=${cursor.id}` : '';
      const res = await fetch(`/api/sync/pull${qs}`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) throw new Error(`pull ${res.status}`);
      const data = (await res.json()) as PullResponse;
      // 행 반영과 커서 전진을 스토어가 한 트랜잭션으로 처리한다
      this.store.applyPull(
        data.rows,
        Array.isArray(data.statuses) ? data.statuses : undefined,
        data.cursor,
      );
      if (data.cursor) cursor = data.cursor;
      if (data.rows.length < 500) break;
    }
  }
}
