/* 알림 팬아웃 — 사건(공부 시작·댓글·응원)을 수신자별 알림 행 + 기기 푸시로 바꾼다.
   순수 판정은 shared/notify.ts, SQL은 queries.ts에 있고 여기는 그 둘을 잇는 오케스트레이션이다.
   푸시 발송기(send)는 주입 가능해서 테스트가 PGlite + 스텁으로 전 경로를 검증한다. */
import { sendPushToAll, type PushBody, type PushEnvVars } from './push';
import { cleanupPhotoTombstones } from './photos';
import {
  allNotifPrefs,
  claimNotificationsPushed,
  deleteGonePushSub,
  deleteOldNotifications,
  entryOwners,
  insertNotificationDedup,
  insertNotificationsDedup,
  insertNotifications,
  priorCommenters,
  pushSubsByMember,
  unpushedReactDailyAll,
  upsertReactionDaily,
  type Db,
  type NewNotification,
} from './queries';
import {
  MEMBER_IDS,
  MEMBER_NAMES,
  type Comment,
  type Entry,
  type MemberId,
  type NotifPrefs,
  type Notification,
  type Post,
  type ReactionEmoji,
} from '../shared/types';
import {
  fmtKstTime,
  kstDayStr,
  kstHourStr,
  parseMentions,
  resolvedStartMode,
  resolveCommentRecipients,
} from '../shared/notify';

/** sendPushToAll과 같은 서명 — 테스트가 스텁을 꽂는 자리. */
export type Sender = typeof sendPushToAll;

/** 응원 하루 요약 푸시가 나가는 시각(KST) — 디자인의 "오후 8:00". */
export const REACT_DAILY_PUSH_AT = '20:00';

/** 보관 정리가 도는 시각(KST) — 트래픽 없는 새벽. */
const CLEANUP_AT = '04:00';

interface Planned {
  m: MemberId;
  rowIds: string[];
  data: PushBody;
}

/** 계획된 푸시를 발송한다 — 늘 바로 보낸다(방해 금지 보류는 기능을 걷어내며 사라졌다).
    발송 전에 소유권을 선점(조건부 도장)한다 — cron이 겹쳐 같은 행을 집어도 한쪽만 보낸다.
    선점 후 발송 전에 죽으면 그 푸시는 유실되지만, 푸시는 어디서나 best-effort고
    인앱 내역이 진실이다. */
async function deliver(
  db: Db,
  env: PushEnvVars,
  planned: Planned[],
  send: Sender,
): Promise<void> {
  if (planned.length === 0) return;
  const subs = await pushSubsByMember(db);
  const claimed = await claimNotificationsPushed(db, planned.flatMap((p) => p.rowIds));
  await Promise.all(
    planned
      .filter((p) => p.rowIds.some((id) => claimed.has(id)))
      .map((p) => {
        const targets = subs.get(p.m) ?? [];
        if (targets.length === 0) return Promise.resolve();
        return send(env, targets, p.data, (endpoint) => deleteGonePushSub(db, endpoint));
      }),
  );
}

/* ---------- 공부 시작 ---------- */

/** off→on 전환 한 건을 수신자별 모드(실시간/하루 1회/끔)로 나눠 알린다.
    쿨다운(claimNotifySlot)은 호출부가 이미 선점했다 — 여기는 수신자 게이트만 본다. */
export async function notifyStart(
  db: Db,
  env: PushEnvVars,
  me: MemberId,
  place: string,
  sinceIso: string,
  nowMs: number,
  send: Sender = sendPushToAll,
): Promise<void> {
  const prefs = await allNotifPrefs(db);
  const day = kstDayStr(nowMs);
  const sinceMs = Date.parse(sinceIso);
  const ctx = `${place} · ${fmtKstTime(Number.isFinite(sinceMs) ? sinceMs : nowMs)}`;
  const data: PushBody = {
    title: `🟢 ${MEMBER_NAMES[me]} — ${place}에서 공부 시작!`,
    body: '오늘도 같이 달려요 👟',
    url: '/',
    tag: `lc-start-${me}`, // 같은 사람의 연속 시작은 기기에서 갱신으로 합쳐진다
  };
  const planned: Planned[] = [];
  for (const m of MEMBER_IDS) {
    if (m === me) continue;
    const mode = resolvedStartMode(prefs[m]);
    if (mode === 'off') continue;
    const base = {
      memberId: m,
      kind: 'start',
      actor: me,
      entryId: null,
      quote: '',
      ctx,
      day,
    } as const;
    if (mode === 'daily') {
      // (수신자, 날짜, start:행위자) 유니크 — 그날 첫 시작만 알림이 된다
      const row = await insertNotificationDedup(db, {
        ...base,
        why: 'daily',
        aggKey: `start:${me}`,
      });
      if (row) planned.push({ m, rowIds: [row.id], data });
    } else {
      const [row] = await insertNotifications(db, [{ ...base, why: 'live', aggKey: null }]);
      planned.push({ m, rowIds: [row!.id], data });
    }
  }
  await deliver(db, env, planned, send);
}

/* ---------- 새 글(기록·라운지) ---------- */

/** 새 기록·라운지 글 한 건씩을 "만든 사람 빼고 전원"에게 알린다 — newWrites 토글이 게이트.
    호출부(sync push)가 신규 판정을 이미 끝냈다: 기록은 CAS 첫 반영(v=1)·라운지 글은 첫 삽입만
    넘어온다. 그래도 aggKey = write:<종류>:<id>로 (수신자, 날짜, 종류+id) 유니크를 한 겹 더
    깐다 — waitUntil이 겹치거나 재전송 판정이 어긋나도 알림 행은 한 번이다(종류를 키에 넣는
    이유: 기록과 라운지 글이 우연히 같은 UUID를 쓰면 한쪽 알림이 조용히 사라진다).
    행 삽입은 항목 × 수신자 전체를 한 문장(bulk)으로 — 큰 배치(오래 오프라인이었던 기기의
    몰아넣기)가 수백 번의 순차 INSERT가 되지 않고, 끊겨도 반쪽짜리 상태가 남지 않는다. */
export async function notifyNewWrites(
  db: Db,
  env: PushEnvVars,
  me: MemberId,
  newEntries: readonly Entry[],
  newPosts: readonly Post[],
  nowMs: number,
  send: Sender = sendPushToAll,
): Promise<void> {
  const prefs = await allNotifPrefs(db);
  const day = kstDayStr(nowMs);
  const name = MEMBER_NAMES[me];
  /* 알림 하나에 실을 내용 — 기록은 태그가, 라운지 글은 본문 첫 줄이 "무슨 글인지"를 말한다.
     기록의 entryId는 행에 실리지만 라운지 글 id는 aggKey에만 남는다(entry_id 열은 uuid라
     맞지 않는 종류를 섞지 않는다 — 지금 알림 행은 어디로도 딥링크하지 않는다). */
  const items = [
    ...newEntries.map((e) => ({
      why: 'entry' as const,
      id: e.id,
      entryId: e.id,
      quote: e.memo.trim(),
      ctx: e.tags.slice(0, 3).join('·'),
      data: {
        title: `✏️ ${name} — 새 기록을 남겼어요`,
        body: e.tags.slice(0, 3).join('·') || '오늘의 공부 기록',
        url: '/',
      },
    })),
    ...newPosts.map((p) => ({
      why: 'post' as const,
      id: p.id,
      entryId: null,
      quote: p.body.trim().slice(0, 80),
      ctx: '라운지',
      data: {
        title: `📝 ${name} — 라운지에 글을 올렸어요`,
        body: p.body.trim().slice(0, 80) || '새 글',
        url: '/',
      },
    })),
  ];
  const byAggKey = new Map(items.map((it) => [`write:${it.why}:${it.id}`, it]));
  const rows: NewNotification[] = [];
  for (const it of items) {
    for (const m of MEMBER_IDS) {
      if (m === me || !prefs[m].newWrites) continue;
      rows.push({
        memberId: m,
        kind: 'write',
        why: it.why,
        actor: me,
        entryId: it.entryId,
        quote: it.quote,
        ctx: it.ctx,
        day,
        aggKey: `write:${it.why}:${it.id}`,
      });
    }
  }
  const inserted = await insertNotificationsDedup(db, rows);
  const planned: Planned[] = inserted.flatMap((row) => {
    const it = row.aggKey === null ? undefined : byAggKey.get(row.aggKey);
    return it ? [{ m: row.m, rowIds: [row.id], data: { ...it.data, tag: `lc-${row.id}` } }] : [];
  });
  await deliver(db, env, planned, send);
}

/* ---------- 댓글 · 응원 ---------- */

function ctxFor(
  info: { owner: MemberId; tags: readonly string[] } | undefined,
  recipient: MemberId,
): string {
  if (!info) return '';
  const who = info.owner === recipient ? '내 기록' : `${MEMBER_NAMES[info.owner]}의 기록`;
  if (info.tags.length === 0) return who;
  const shown = info.tags.slice(0, 3).join('·');
  const rest = info.tags.length - 3;
  return `${who} · ${shown}${rest > 0 ? ` 외 ${rest}` : ''}`;
}

function commentPush(row: Notification, actor: MemberId): PushBody {
  const name = MEMBER_NAMES[actor];
  const title =
    row.why === 'mention'
      ? `📣 ${name}님이 나를 언급했어요`
      : row.why === 'mine'
        ? `💬 ${name} — 내 기록에 댓글`
        : row.why === 'reply'
          ? `💬 ${name} — 내 댓글에 답글`
          : `💬 ${name} — 크루 기록에 댓글`;
  return {
    title,
    body: row.quote.length > 120 ? row.quote.slice(0, 119) + '…' : row.quote,
    url: '/?view=noti',
    tag: `lc-${row.id}`, // 댓글 알림은 각각 별개 — 절대 서로를 덮지 않는다
  };
}

export interface ReactionDelta {
  entryId: string;
  added: ReactionEmoji[];
}

/** sync push가 방금 반영한 댓글·리액션을 알림으로 바꾼다 — waitUntil 안에서 돈다. */
export async function notifyCommentEvents(
  db: Db,
  env: PushEnvVars,
  me: MemberId,
  newComments: Comment[],
  reactionDeltas: ReactionDelta[],
  nowMs: number,
  send: Sender = sendPushToAll,
): Promise<void> {
  const deltas = reactionDeltas.filter((d) => d.added.length > 0);
  if (newComments.length === 0 && deltas.length === 0) return;
  const prefs = await allNotifPrefs(db);
  const day = kstDayStr(nowMs);
  const entryIds = [...new Set([...newComments.map((c) => c.entryId), ...deltas.map((d) => d.entryId)])];
  const owners = await entryOwners(db, entryIds);
  const prior = newComments.length
    ? await priorCommenters(
        db,
        [...new Set(newComments.map((c) => c.entryId))],
        newComments.map((c) => c.id),
      )
    : new Map<string, { m: MemberId; createdAt: string }[]>();

  const rows: NewNotification[] = [];
  for (const c of newComments) {
    const info = owners.get(c.entryId);
    // "이전" 댓글러 = 이 댓글보다 먼저 쓴 사람만. 팬아웃이 늦는 사이 끼어든 더 나중
    // 댓글의 작성자에게 reply 배지를 붙이지 않는다(그 사람에겐 이게 답글이 아니다).
    const priorMembers = [
      ...new Set(
        (prior.get(c.entryId) ?? [])
          .filter((p) => p.createdAt < c.createdAt)
          .map((p) => p.m),
      ),
    ];
    const recips = resolveCommentRecipients(
      {
        actor: me,
        entryOwner: info?.owner ?? null,
        priorCommenters: priorMembers,
        mentions: parseMentions(c.body),
      },
      prefs,
    );
    for (const r of recips) {
      rows.push({
        memberId: r.m,
        kind: r.kind,
        why: r.why,
        actor: me,
        entryId: c.entryId,
        quote: c.body,
        ctx: ctxFor(info, r.m),
        day,
        aggKey: null,
      });
    }
  }
  const inserted = await insertNotifications(db, rows);
  const planned: Planned[] = inserted.map((row) => ({
    m: row.m,
    rowIds: [row.id],
    data: commentPush(row, me),
  }));

  for (const d of deltas) {
    const info = owners.get(d.entryId);
    // 주인을 모르는(아직 push 안 된) 기록의 응원은 조용히 넘어간다 — 다음 응원 때 잡힌다
    if (!info || info.owner === me) continue;
    /* 응원은 늘 하루 요약이다 — 설정 노브(reactMode)는 걷어냈다. 서버 행에 남아 있을 수
       있는 옛 값이 보이지 않는 곳에서 알림을 좌우하면 설정 화면이 거짓말이 되므로 읽지
       않는다(열은 하위 호환으로 남긴다). 행만 쌓고 푸시는 저녁 cron(REACT_DAILY_PUSH_AT)이
       한 번에 보낸다. */
    await upsertReactionDaily(db, info.owner, day, me, d.added.length);
  }
  await deliver(db, env, planned, send);
}

/* ---------- 시간 단위 cron ---------- */

/** 매시 정각 cron의 일감: 저녁 응원 요약 푸시, 보관 정리.
    발송 시각(REACT_DAILY_PUSH_AT·CLEANUP_AT)이 'HH:00'이라 시간 단위면 충분하다. */
export async function runHourly(
  db: Db,
  env: PushEnvVars & { PHOTOS: R2Bucket },
  nowMs: number,
  send: Sender = sendPushToAll,
): Promise<void> {
  // R2 오류로 남은 톰스톤은 매시 먼저 재시도한다. DB 정산 전에 실패하면
  // 행이 그대로 남아 다음 시간을 기다린다. 이 일의 실패는 알림 cron을 막지 않는다.
  try {
    await cleanupPhotoTombstones(db, env.PHOTOS);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'photo tombstone cron failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const hour = kstHourStr(nowMs);
  const subs = await pushSubsByMember(db);
  const onGone = (endpoint: string) => deleteGonePushSub(db, endpoint);

  // 1) 응원 하루 요약 — 발송 대기 중인 집계 행 전부(어제 20시 이후 생긴 것 포함).
  //    "오늘" 필터를 두면 그 경계 밖에서 생긴 행이 영영 안 나간다 — 하루 늦은 요약이 유실보다 낫다.
  if (hour === REACT_DAILY_PUSH_AT) {
    for (const agg of await unpushedReactDailyAll(db)) {
      const m = agg.m;
      // 조건부 도장 선점 — cron이 겹쳐 돌아도 한쪽만 보낸다
      const claimed = await claimNotificationsPushed(db, [agg.id]);
      if (!claimed.has(agg.id)) continue;
      const targets = subs.get(m) ?? [];
      if (targets.length) {
        await send(
          env,
          targets,
          {
            title: `💛 받은 응원 ${agg.count}개`,
            body: '크루가 보낸 응원을 모아 왔어요',
            url: '/?view=noti',
            tag: 'lc-react-daily',
          },
          onGone,
        );
      }
    }
  }

  // 2) 보관 정리 — 하루 한 번
  if (hour === CLEANUP_AT) await deleteOldNotifications(db);
}
