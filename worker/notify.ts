/* 알림 팬아웃 — 사건(공부 시작·댓글·응원)을 수신자별 알림 행 + 기기 푸시로 바꾼다.
   순수 판정은 shared/notify.ts, SQL은 queries.ts에 있고 여기는 그 둘을 잇는 오케스트레이션이다.
   푸시 발송기(send)는 주입 가능해서 테스트가 PGlite + 스텁으로 전 경로를 검증한다. */
import { sendPushToAll, type PushBody, type PushEnvVars } from './push';
import {
  allNotifPrefs,
  claimNotificationsPushed,
  deleteGonePushSub,
  deleteOldNotifications,
  entryOwners,
  insertNotificationDedup,
  insertNotifications,
  markNotificationsPushed,
  priorCommenters,
  pushSubsByMember,
  unpushedQuietRows,
  unpushedReactDailyAll,
  upsertReactionDaily,
  type Db,
  type NewNotification,
} from './queries';
import {
  MEMBER_IDS,
  MEMBER_NAMES,
  type Comment,
  type MemberId,
  type NotifPrefs,
  type Notification,
  type ReactionEmoji,
} from '../shared/types';
import {
  fmtKstTime,
  inQuietHours,
  kstDayStr,
  kstHourStr,
  kstMinutes,
  parseMentions,
  quietSpanMinutes,
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

/** 계획된 푸시를 수신자별 설정에 따라 발송한다.
    방해 금지 중인 수신자는 보류(pushed_at null 유지) — quietTo 시각의 cron이 모아서 알린다.
    발송 전에 소유권을 선점(조건부 도장)한다 — 그 사이 cron 다이제스트가 같은 행을 쓸어 담아도
    한쪽만 보낸다. 선점 후 발송 전에 죽으면 그 푸시는 유실되지만, 푸시는 어디서나
    best-effort고 인앱 내역이 진실이다. */
async function deliver(
  db: Db,
  env: PushEnvVars,
  prefs: Record<MemberId, NotifPrefs>,
  planned: Planned[],
  nowMs: number,
  send: Sender,
): Promise<void> {
  if (planned.length === 0) return;
  const subs = await pushSubsByMember(db);
  const minutes = kstMinutes(nowMs);
  const eligible = planned.filter((p) => !inQuietHours(prefs[p.m], minutes));
  const claimed = await claimNotificationsPushed(db, eligible.flatMap((p) => p.rowIds));
  await Promise.all(
    eligible
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
    const mode = resolvedStartMode(prefs[m], me);
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
  await deliver(db, env, prefs, planned, nowMs, send);
}

/* ---------- 댓글 · 응원 ---------- */

function ctxFor(
  info: { owner: MemberId; tags: readonly string[] } | undefined,
  recipient: MemberId,
): string {
  if (!info) return '';
  const who = info.owner === recipient ? '내 기록' : `${MEMBER_NAMES[info.owner]}의 기록`;
  return info.tags.length ? `${who} · ${info.tags.join('·')}` : who;
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
    const mode = prefs[info.owner].reactMode;
    if (mode === 'off') continue;
    if (mode === 'live') {
      const [row] = await insertNotifications(db, [
        {
          memberId: info.owner,
          kind: 'react',
          why: 'react',
          actor: me,
          entryId: d.entryId,
          quote: d.added.join(' '),
          ctx: ctxFor(info, info.owner),
          day,
          aggKey: null,
        },
      ]);
      planned.push({
        m: info.owner,
        rowIds: [row!.id],
        data: {
          title: `💛 ${MEMBER_NAMES[me]} — 응원을 보냈어요`,
          body: d.added.join(' '),
          url: '/?view=noti',
          tag: `lc-${row!.id}`,
        },
      });
    } else {
      // 하루 요약 — 행만 쌓고 푸시는 저녁 cron(REACT_DAILY_PUSH_AT)이 한 번에 보낸다
      await upsertReactionDaily(db, info.owner, day, me, d.added.length);
    }
  }
  await deliver(db, env, prefs, planned, nowMs, send);
}

/* ---------- 시간 단위 cron ---------- */

const KIND_WORD: Record<string, string> = {
  start: '시작',
  comment: '댓글',
  reply: '댓글',
  mention: '멘션',
  react: '응원',
};

/** 다이제스트 부가 설명 — 앞 두 건만 시각·이름으로 요약하고 나머지는 개수로 접는다. */
function digestCtx(rows: Notification[]): string {
  const parts = rows.slice(0, 2).map((r) => {
    const name = r.actor ? MEMBER_NAMES[r.actor] : '크루';
    return `${fmtKstTime(Date.parse(r.createdAt))} ${name} ${KIND_WORD[r.kind] ?? '알림'}`;
  });
  const restCount = rows.length - parts.length;
  return parts.join(' · ') + (restCount > 0 ? ` 외 ${restCount}개` : '');
}

/** 매시 정각 cron의 일감: 저녁 응원 요약 푸시, 방해 금지 다이제스트, 보관 정리.
    설정의 시각 값이 전부 'HH:00'이라(검증이 강제) 시간 단위면 충분하다. */
export async function runHourly(
  db: Db,
  env: PushEnvVars,
  nowMs: number,
  send: Sender = sendPushToAll,
): Promise<void> {
  const hour = kstHourStr(nowMs);
  const day = kstDayStr(nowMs);
  const prefs = await allNotifPrefs(db);
  const subs = await pushSubsByMember(db);
  const onGone = (endpoint: string) => deleteGonePushSub(db, endpoint);

  // 1) 응원 하루 요약 — 발송 대기 중인 집계 행 전부(어제 20시 이후·방해 금지 보류분 포함).
  //    "오늘" 필터를 두면 그 경계 밖에서 생긴 행이 영영 안 나간다 — 하루 늦은 요약이 유실보다 낫다.
  if (hour === REACT_DAILY_PUSH_AT) {
    for (const agg of await unpushedReactDailyAll(db)) {
      const m = agg.m;
      if (prefs[m].reactMode !== 'daily') continue;
      if (inQuietHours(prefs[m], kstMinutes(nowMs))) continue; // 보류 유지 — 다음 기회에
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

  // 2) 방해 금지 다이제스트 — 창이 끝나는 시각의 멤버만
  for (const m of MEMBER_IDS) {
    const p = prefs[m];
    if (!p.quietEnabled || p.quietTo !== hour) continue;
    const span = quietSpanMinutes(p);
    if (span === 0) continue;
    const rows = await unpushedQuietRows(db, m, new Date(nowMs - span * 60_000).toISOString());
    if (rows.length === 0) continue;
    // 조건부 도장 선점 — cron이 겹쳐 돌면 실제로 찍은 행만 이번 다이제스트의 몫이다
    const claimedIds = await claimNotificationsPushed(db, rows.map((r) => r.id));
    const claimed = rows.filter((r) => claimedIds.has(r.id));
    if (claimed.length === 0) continue;
    // (수신자, 날짜, quiet) 유니크 — 다이제스트 행도 하루 1건
    const sys = await insertNotificationDedup(db, {
      memberId: m,
      kind: 'system',
      why: 'quiet',
      actor: null,
      entryId: null,
      quote: '',
      ctx: digestCtx(claimed),
      day,
      aggKey: 'quiet',
      count: claimed.length,
    });
    if (sys) await markNotificationsPushed(db, [sys.id]);
    const targets = subs.get(m) ?? [];
    if (targets.length) {
      await send(
        env,
        targets,
        {
          title: `🌙 조용한 시간 동안 알림 ${claimed.length}개`,
          body: digestCtx(claimed),
          url: '/?view=noti',
          tag: 'lc-quiet',
        },
        onGone,
      );
    }
  }

  // 3) 보관 정리 — 하루 한 번
  if (hour === CLEANUP_AT) await deleteOldNotifications(db);
}
