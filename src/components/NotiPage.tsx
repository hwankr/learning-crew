/* 알림 내역 페이지 — 디자인(알림 - 모바일.dc.html)의 내역 화면.
   행 문구·배지·그룹핑은 전부 스냅샷(Notification[])에서 파생한다 — 여기서 쓰기는
   "읽음 처리"뿐이고, 같은 날의 크루 전체 댓글(why=all)은 표시할 때만 한 줄로 접는다. */
import { useEffect, useMemo, useState } from 'react';
import type { NotifKind, NotifWhy, Notification } from '../../shared/types';
import { MEMBER_NAMES } from '../../shared/types';
import { BY_ID, W, dayKey, pad2 } from '../lib/constants';
import { Avatar, BELL_D, Icon } from './icons';

/* ---------- 표시 규칙 (순수 — 테스트가 직접 부른다) ---------- */

/** 배지 문구·색 — 디자인의 WHY 표. 색은 동적 값이라 인라인 스타일로 준다. */
export const WHY_BADGE: Record<NotifWhy, { label: string; bg: string; fg: string }> = {
  mention: { label: '멘션 · 항상', bg: '#FFF0BF', fg: '#8A5A00' },
  mine: { label: '내 기록의 댓글', bg: '#E7F1FF', fg: '#14579F' },
  reply: { label: '내 댓글의 답글', bg: '#E7F1FF', fg: '#14579F' },
  all: { label: '크루 전체 댓글', bg: '#E7F1FF', fg: '#14579F' },
  react: { label: '반응 · 바로', bg: '#E6F9F0', fg: '#0A6E42' },
  react_daily: { label: '반응 · 하루 요약', bg: '#E6F9F0', fg: '#0A6E42' },
  daily: { label: '시작 · 하루 1회', bg: '#F1F3F6', fg: '#4E555F' },
  live: { label: '시작 · 실시간', bg: '#F1F3F6', fg: '#4E555F' },
  quiet: { label: '방해 금지 시간', bg: '#F1F3F6', fg: '#4E555F' },
};

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'unread', label: '안 읽음' },
  { id: 'start', label: '공부 시작' },
  { id: 'comment', label: '댓글' },
  { id: 'mention', label: '멘션' },
  { id: 'react', label: '반응' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

/** 필터용 종류 — 답글은 '댓글' 필터에 함께 잡힌다(디자인과 동일). */
function kindOf(n: Notification): NotifKind {
  return n.kind === 'reply' ? 'comment' : n.kind;
}

export function matchesFilter(n: Notification, f: FilterId): boolean {
  if (f === 'all') return true;
  if (f === 'unread') return n.readAt === null;
  return kindOf(n) === f;
}

/** 이름 뒤에 붙는 문장 — kind/why 조합이 곧 문구다. */
export function restOf(n: Notification): string {
  if (n.kind === 'system') return `방해 금지 시간에 온 알림 ${n.count}개를 모아서 보냈어요`;
  if (n.kind === 'mention') return '님이 댓글에서 나를 언급했어요';
  if (n.kind === 'reply') return '님이 내 댓글에 답글을 남겼어요';
  if (n.kind === 'comment') {
    return n.why === 'all' ? '님이 크루 기록에 댓글을 남겼어요' : '님이 내 기록에 댓글을 남겼어요';
  }
  if (n.kind === 'start') {
    return n.why === 'daily' ? '님이 오늘 첫 공부를 시작했어요' : '님이 공부를 시작했어요';
  }
  // react
  if (n.why === 'react_daily') {
    const extra = Math.max(0, n.actors.length - 1);
    return extra > 0 ? `님 외 ${extra}명이 오늘 기록에 응원을 보냈어요` : '님이 오늘 기록에 응원을 보냈어요';
  }
  return '님이 내 기록에 응원을 보냈어요';
}

/** 행 앞에 서는 이름 — system은 이름 없이 문장만 쓴다. */
export function nameOf(n: Notification): string {
  if (n.kind === 'system') return '';
  if (n.why === 'react_daily') {
    const first = n.actors[0];
    return first ? MEMBER_NAMES[first] : '크루';
  }
  return n.actor ? MEMBER_NAMES[n.actor] : '크루';
}

/** 부가 설명 한 줄 — 집계 행은 서버가 비워 보내므로 count로 만든다. */
export function ctxOf(n: Notification): string {
  if (n.why === 'react_daily') return `응원 ${n.count}개 · 하루 요약으로 한 번에`;
  return n.ctx;
}

/** 표시 시각의 기준 — 모든 행이 createdAt이다. 집계 행도 마찬가지: updatedAt은 읽음
    동기화로도 올라가서, 그걸 쓰면 읽는 순간 행의 시각·날짜 그룹이 움직인다.
    (정렬도 createdAt이라 표시·정렬·그룹이 늘 같은 축을 쓴다) */
export function displayAt(n: Notification): string {
  return n.createdAt;
}

/** '오후 2:14' — 기기 로컬 시간대(크루가 전원 한국이라 서버 KST 문구와 자연히 맞는다). */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${pad2(d.getMinutes())}`;
}

/** 날짜 그룹 라벨 — 오늘 / 어제 / 이번 주 X요일 / M월 D일. */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const key = dayKey(d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff <= 0 && key === dayKey(now)) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7) return `이번 주 ${W[d.getDay()]}요일`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 하루 그룹 안에서 크루 전체 댓글(why=all)이 2건 이상이면 한 줄로 접는다. */
export interface NotiRow {
  key: string;
  head: Notification; // 대표(가장 최신) 행 — 배지·시각이 이 행을 따른다
  group: Notification[]; // 접힌 원본들 (일반 행은 [head])
}

export function groupDayRows(items: Notification[], dayId: string): NotiRow[] {
  const alls = items.filter((n) => n.why === 'all');
  if (alls.length < 2) return items.map((n) => ({ key: n.id, head: n, group: [n] }));
  const rest = items.filter((n) => n.why !== 'all');
  const out: NotiRow[] = rest.map((n) => ({ key: n.id, head: n, group: [n] }));
  // 접힌 줄의 키는 날짜 기반 — 같은 날 새 댓글이 와 대표 행이 바뀌어도 펼친 상태가 유지된다
  out.push({ key: `all:${dayId}`, head: alls[0]!, group: alls });
  // 접힌 줄도 시간 순서(최신 먼저)에 맞는 자리로
  out.sort((a, b) => (displayAt(a.head) < displayAt(b.head) ? 1 : -1));
  return out;
}

/* ---------- 컴포넌트 ---------- */

function BellCircle({ size }: { size: number }) {
  return (
    <span className="noti-bell-av" style={{ width: size, height: size }}>
      <Icon d={BELL_D} size={Math.round(size * 0.5)} sw={2.2} />
    </span>
  );
}

interface Props {
  notifications: Notification[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onOpenSettings: () => void;
}

export function NotiPage({ notifications, onRead, onReadAll, onOpenSettings }: Props) {
  const [filter, setFilter] = useState<FilterId>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 자정을 넘기면 "오늘/어제" 라벨이 바뀌어야 한다 — 분 단위로 날짜 키를 확인해
  // 바뀔 때만 리렌더한다(밤새 열어 둔 탭 대비)
  const [todayId, setTodayId] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const t = setInterval(() => {
      const k = dayKey(new Date());
      setTodayId((cur) => (cur === k ? cur : k));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  const now = new Date();

  const unread = notifications.filter((n) => n.readAt === null).length;
  const week = notifications.filter(
    (n) => Date.now() - Date.parse(displayAt(n)) < 7 * 86_400_000,
  ).length;

  // 날짜 그룹 → (필터 적용) → all 접기. 그룹 라벨은 필터와 무관하게 원본 순서를 따른다.
  const groups = useMemo(() => {
    const filtered = notifications.filter((n) => matchesFilter(n, filter));
    const byDay = new Map<string, { label: string; items: Notification[] }>();
    for (const n of filtered) {
      const id = dayKey(new Date(displayAt(n)));
      const cur = byDay.get(id);
      if (cur) cur.items.push(n);
      else byDay.set(id, { label: dayLabel(displayAt(n), now), items: [n] });
    }
    return [...byDay.entries()].map(([id, g]) => ({
      id,
      label: g.label,
      rows: groupDayRows(g.items, id),
    }));
    // now는 todayId가 갈리기 전까지 라벨 계산 결과가 같다 — todayId가 자정 신호다
  }, [notifications, filter, todayId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="noti-page">
      <div className="noti-head">
        <div className="noti-title">알림</div>
        <button className="icon-btn" title="알림 설정" aria-label="알림 설정" onClick={onOpenSettings}>
          <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
            <circle cx={12} cy={12} r={3.2} />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.87-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 2.6 15H2.5a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.87l-.06-.06A2 2 0 1 1 6.57 5.24l.06.06A1.7 1.7 0 0 0 9.5 4.1V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 21.4 11h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.53 1z" />
          </svg>
        </button>
      </div>
      <div className="noti-summary">
        <span className="noti-summary-text">
          {unread > 0 ? `안 읽은 알림 ${unread}개 · 지난 7일 ${week}개` : `모두 확인했어요 · 지난 7일 ${week}개`}
        </span>
        {unread > 0 && (
          <button className="noti-readall" onClick={onReadAll}>모두 읽음</button>
        )}
      </div>
      <div className="noti-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={'noti-chip' + (filter === f.id ? ' on' : '')}
            aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.id === 'unread' && unread > 0 ? `안 읽음 ${unread}` : f.label}
          </button>
        ))}
      </div>
      {groups.length === 0 && <div className="noti-empty">해당하는 알림이 없어요.</div>}
      {groups.map((g) => (
        <div key={g.id} className="noti-group">
          <div className="noti-group-label">{g.label}</div>
          <div>
            {g.rows.map((row) => {
              const n = row.head;
              const grouped = row.group.length > 1;
              const anyUnread = row.group.some((x) => x.readAt === null);
              const badge = WHY_BADGE[n.why];
              const member = n.actor ? BY_ID[n.actor] : undefined;
              const actorCount = new Set(row.group.map((x) => x.actor)).size;
              const name = grouped
                ? `${nameOf(n)}${actorCount > 1 ? ` 외 ${actorCount - 1}명` : ''}`
                : nameOf(n);
              const rest = grouped
                ? `님이 크루 기록에 댓글 ${row.group.length}개를 남겼어요`
                : restOf(n);
              const ctx = grouped ? '' : ctxOf(n);
              const isOpen = !!open[row.key];
              const read = (): void => row.group.forEach((x) => x.readAt === null && onRead(x.id));
              // 행 자체는 role=button div — 안에 진짜 <button>(펼치기)이 서야 해서
              // button 안에 button을 중첩하는 무효 HTML을 피한다
              return (
                <div key={row.key}
                  className={'noti-row' + (anyUnread ? ' unread' : '')}
                  role="button" tabIndex={0}
                  aria-label={anyUnread ? '읽음으로 표시' : undefined}
                  onClick={read}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      read();
                    }
                  }}>
                  <span className="noti-dot-col">
                    <span className="noti-dot" style={{ background: anyUnread ? '#FFB800' : 'transparent' }} />
                  </span>
                  {member ? <Avatar m={member} size={38} /> : <BellCircle size={38} />}
                  <span className="noti-main">
                    <span className="noti-text">
                      {name && <span className="noti-name">{name}</span>}
                      <span className="noti-rest">{rest}</span>
                    </span>
                    {!grouped && n.quote && <span className="noti-quote">{n.quote}</span>}
                    {ctx && <span className="noti-ctx">{ctx}</span>}
                    {grouped && isOpen && (
                      <span className="noti-sub">
                        {row.group.map((x) => (
                          <span key={x.id} className="noti-sub-item">
                            <span className="noti-sub-line">
                              <span className="noti-sub-name">{nameOf(x)}</span>
                              {`님 → ${x.ctx.split(' · ')[0] || '크루 기록'}`}
                            </span>
                            {x.quote && <span className="noti-sub-quote">{x.quote}</span>}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="noti-meta">
                      <span className="noti-why" style={{ background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                      <span className="noti-time">{fmtTime(displayAt(n))}</span>
                      {grouped && (
                        <button type="button" className="noti-expand" aria-expanded={isOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen((p) => ({ ...p, [row.key]: !p[row.key] }));
                          }}>
                          {isOpen ? '접기' : `댓글 ${row.group.length}개 보기`}
                        </button>
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="noti-foot-note">알림을 눌러 읽음으로 표시할 수 있어요. 내역은 30일간 보관돼요.</div>
    </div>
  );
}
