/* 알림 판정의 순수 로직 — Worker(생성·발송)와 클라이언트(표시)가 같은 정의를 쓴다.
   DB·네트워크가 없어 유닛 테스트가 그대로 이 파일을 검증한다. */
import {
  MEMBER_IDS,
  MEMBER_NAMES,
  type MemberId,
  type NotifKind,
  type NotifMode,
  type NotifPrefs,
  type NotifWhy,
} from './types';

/* ---------- 멘션 ---------- */

/** 댓글 본문에서 @이름 멘션을 뽑는다 — 본인 이름 사전(MEMBER_NAMES)만 인정.
    몇 명뿐인 크루라 자동완성 없이 손으로 치는 걸 전제로, '@승환' 부분 문자열이면 충분하다.
    단 이름끼리 부분 문자열로 겹치면(예: '진주'와 '진주희') 한 번에 둘 다 잡히므로,
    멤버를 추가할 때는 기존 이름의 부분 문자열이 아닌지 확인할 것 —
    notify.test.ts의 회귀 테스트가 이 조건을 지킨다. */
export function parseMentions(body: string): MemberId[] {
  return MEMBER_IDS.filter((m) => body.includes('@' + MEMBER_NAMES[m]));
}

/* ---------- 댓글 알림 수신자 결정 ---------- */

export interface CommentEvent {
  actor: MemberId;
  /** 기록 주인 — 그 기록이 아직 서버에 없으면 null (mine 판정만 빠진다) */
  entryOwner: MemberId | null;
  /** 이 댓글 이전에 그 기록에 살아 있는 댓글을 단 멤버들 */
  priorCommenters: readonly MemberId[];
  mentions: readonly MemberId[];
}

export interface CommentRecipient {
  m: MemberId;
  kind: NotifKind;
  why: NotifWhy;
}

/** 댓글 한 건이 만들 알림 수신자와 이유. 멤버당 최대 1건, 우선순위는
    멘션(항상) > 내 기록(mine) > 내 대화(reply) > 크루 전체(all) — 디자인의 배지 체계와 같다. */
export function resolveCommentRecipients(
  ev: CommentEvent,
  prefs: Readonly<Record<MemberId, NotifPrefs>>,
): CommentRecipient[] {
  const out: CommentRecipient[] = [];
  for (const m of MEMBER_IDS) {
    if (m === ev.actor) continue;
    const p = prefs[m];
    if (ev.mentions.includes(m)) {
      out.push({ m, kind: 'mention', why: 'mention' }); // 설정과 무관하게 항상
    } else if (ev.entryOwner === m) {
      if (p.cmMine) out.push({ m, kind: 'comment', why: 'mine' });
    } else if (ev.priorCommenters.includes(m)) {
      if (p.cmReply) out.push({ m, kind: 'reply', why: 'reply' });
    } else if (p.cmAll) {
      out.push({ m, kind: 'comment', why: 'all' });
    }
  }
  return out;
}

/* ---------- 공부 시작 모드 ---------- */

/** 수신자의 시작 알림 모드 — 크루 구분 없이 하나다. 크루별 오버라이드 UI는 걷어냈고,
    서버 행에 남아 있을 수 있는 옛 perMember 값도 여기서 무시한다: 설정 화면에 보이지 않는
    값이 알림을 좌우하면 화면이 거짓말이 된다(perMember 열 자체는 하위 호환으로 남긴다). */
export function resolvedStartMode(p: NotifPrefs): NotifMode {
  return p.startMode;
}

/* 방해 금지 시간은 기능째 걷어냈다 — 푸시는 늘 바로 나간다. NotifPrefs의 quiet* 필드와
   저장 열은 하위 호환으로만 남아 있고 어디서도 읽지 않는다. */

/* ---------- KST 시각 ----------
   크루가 전원 한국이라 서버의 "그 날"·"그 시각" 판정은 KST 고정이다.
   (클라이언트 표시는 기기 로컬 시간대를 그대로 쓴다 — 여기 함수는 서버 판정 전용) */

export const KST_OFFSET_MS = 9 * 3600_000;

/** UTC 게터가 곧 KST가 되도록 밀어 둔 Date — 반드시 getUTC* 계열로만 읽을 것. */
function kstDate(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS);
}

/** KST 기준 YYYY-MM-DD — 알림의 날짜 키(집계·하루 1회 중복 방지)가 이걸 쓴다. */
export function kstDayStr(ms: number): string {
  return kstDate(ms).toISOString().slice(0, 10);
}

/** KST 기준 하루 안의 분(0..1439). */
export function kstMinutes(ms: number): number {
  const d = kstDate(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** KST 기준 'HH:00' — 시간 단위 cron이 설정값(quietTo 등)과 대조하는 키. */
export function kstHourStr(ms: number): string {
  return String(kstDate(ms).getUTCHours()).padStart(2, '0') + ':00';
}

/** KST 기준 '오후 2:14' — 서버가 미리 굽는 부가 설명(ctx) 문구용. */
export function fmtKstTime(ms: number): string {
  const d = kstDate(ms);
  const h = d.getUTCHours();
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
