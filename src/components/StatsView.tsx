/* 통계 — 나/크루 × 이번 달/지난 달/전체를 잔디·스트립·막대로 편다(디자인 원본: 통계 페이지.dc.html).
   숫자의 근원은 크루 패널 월 요약과 같은 studyDaysOf 하나다 — 화면마다 "공부한 날"을
   다르게 세면 같은 사람의 일수가 자리마다 어긋난다. 태그는 기록에서만 나온다: 도장만
   있는 날은 태그 필터에서 "공부는 했지만 무엇인지 모르는 날"(회색)로 남는 게 사실 그대로다. */
import { useMemo } from 'react';
import type { Entry, MemberId, MemberStatus, Tag } from '../../shared/types';
import { TAGS } from '../../shared/types';
import { MEMBERS, W, pad2, tagMeta, type Member } from '../lib/constants';
import { dayTagsOf, maxStreakOf, monthKeysOf, streakOf, studyDaysOf } from '../lib/stats';
import { useIsDesktop } from '../lib/useMediaQuery';
import { Avatar } from './icons';
import { MeBadge } from './Board';

export type StatScope = 'me' | 'crew';
export type StatPeriod = 'cur' | 'prev' | 'all';

/* 태그의 통계 색 — 기본 태그는 시안의 스와치(피드 칩의 옅은 배경과 달리 잔디 칸을
   칠할 수 있는 원색), 커스텀 태그는 칩의 진한 글자색이 그대로 구분색이 된다.
   '기타'만 스와치와 칸 색이 다르다: 연회색 칸은 빈 날(#F5F6F8)과 구분이 안 된다. */
const TAG_SWATCH: Record<string, { sw: string; cell: string }> = {
  '자격증': { sw: '#FFB800', cell: '#FFB800' },
  '영어': { sw: '#2E90FA', cell: '#2E90FA' },
  '코딩테스트': { sw: '#12B76A', cell: '#12B76A' },
  '기타': { sw: '#C9CFD8', cell: '#9AA1AD' },
};

function tagLook(tag: Tag): { sw: string; cell: string } {
  const fixed = Object.prototype.hasOwnProperty.call(TAG_SWATCH, tag)
    ? TAG_SWATCH[tag]
    : undefined;
  if (fixed) return fixed;
  const { fg } = tagMeta(tag);
  return { sw: fg, cell: fg };
}

interface MonthInfo {
  mk: string; // 'YYYY-MM'
  label: string;
  dim: number; // 그 달의 일수
  upTo: number; // 지나간 마지막 날 — 이번 달은 오늘, 지난 달은 말일
  offset: number; // 1일의 요일 (일=0)
}

function monthInfoOf(mk: string, today: Date): MonthInfo {
  const y = +mk.slice(0, 4);
  const mo = +mk.slice(5, 7);
  const isCur = y === today.getFullYear() && mo - 1 === today.getMonth();
  return {
    mk,
    // 올해 안이면 "8월", 해가 다르면 "2025년 12월" — 전체 화면이 해를 넘겨도 헷갈리지 않게
    label: y === today.getFullYear() ? `${mo}월` : `${y}년 ${mo}월`,
    dim: new Date(y, mo, 0).getDate(),
    upTo: isCur ? today.getDate() : new Date(y, mo, 0).getDate(),
    offset: new Date(y, mo - 1, 1).getDay(),
  };
}

interface MemberStat {
  m: Member;
  days: ReadonlySet<string>;
  tags: Map<string, Tag[]>;
}

export function StatsView({
  entries, studyDays, statuses, meId, now, today,
  scope, period, rawSel, onScope, onPeriod, onSel,
}: {
  entries: Entry[];
  /** 멤버별 공부 시작 도장 날짜 이력 — 크루 패널 월 요약과 같은 원천 */
  studyDays: Partial<Record<MemberId, ReadonlySet<string>>>;
  statuses: Partial<Record<MemberId, MemberStatus>>;
  meId: MemberId;
  /** 분 단위로 갱신되는 지금 시각 — 라이브 체크인의 오늘 도장이 여기서 갱신된다 */
  now: number;
  today: Date;
  /** 스코프·기간·태그 필터는 App이 든다 — 셸 전환·탭 이동의 리마운트에 풀리지 않게
      (캘린더 멤버 필터와 같은 규칙). rawSel은 고른 그대로의 값이고, 지금 화면에
      실제로 적용할지는 아래 sel 파생이 정한다. */
  scope: StatScope;
  period: StatPeriod;
  rawSel: Tag | null;
  onScope: (s: StatScope) => void;
  onPeriod: (p: StatPeriod) => void;
  onSel: (t: Tag | null) => void;
}) {
  const desktop = useIsDesktop();

  const stats = useMemo<MemberStat[]>(
    () => MEMBERS.map((m) => ({
      m,
      days: studyDaysOf(entries, m.id, studyDays[m.id], statuses[m.id], now),
      tags: dayTagsOf(entries, m.id),
    })),
    [entries, studyDays, statuses, now],
  );
  const mine = stats.find((s) => s.m.id === meId) ?? stats[0]!;

  const curMk = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMk = `${prevDate.getFullYear()}-${pad2(prevDate.getMonth() + 1)}`;
  // 잔디·크루 스트립이 그리는 달 — '전체'에서는 이 두 카드가 서지 않는다
  const gm = monthInfoOf(period === 'prev' ? prevMk : curMk, today);
  const inPeriod = (day: string): boolean =>
    period === 'all' ? true : day.startsWith(gm.mk + '-');

  /* ---------- 태그 비중 — 필터(sel)의 근거 ---------- */
  const counts = new Map<Tag, number>();
  const scoped = scope === 'me' ? [mine] : stats;
  for (const s of scoped) {
    for (const [day, tags] of s.tags) {
      if (!inPeriod(day)) continue;
      /* OFF는 쉰 날이지 공부 태그가 아니다 — 비중에도 필터에도 넣지 않는다.
         다만 그 날 자체는 잔디·일수·연속에 남는다: 일수의 근원이 크루 패널 월 요약과
         같은 studyDaysOf 하나여야 두 화면의 숫자가 안 어긋나고, 쉬는 날을 기록으로
         남기면 연속이 안 끊기는 것도 그 규약의 일부다(재충전도 습관의 하루다). */
      for (const t of tags) if (t !== 'OFF') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const knownTags = TAGS.filter((t) => t !== 'OFF' && (counts.get(t) ?? 0) > 0);
  const customTags = [...counts.keys()]
    .filter((t) => !(TAGS as readonly string[]).includes(t))
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b, 'ko'));
  const legendTags: Tag[] = [...knownTags, ...customTags];
  const tagTotal = legendTags.reduce((a, t) => a + counts.get(t)!, 0);

  // 범위·기간을 옮겨 고른 태그가 목록에서 사라졌으면 필터도 함께 풀린 것으로 본다 —
  // 보이지 않는 필터가 잔디를 온통 회색으로 만들면 고장으로 읽힌다.
  const sel = rawSel !== null && (counts.get(rawSel) ?? 0) > 0 ? rawSel : null;
  const selCell = sel ? tagLook(sel).cell : null;
  const toggleTag = (t: Tag) => onSel(sel === t ? null : t);
  const dimOf = (t: Tag): number => (sel && sel !== t ? 0.35 : 1);

  /* ---------- 일수 세기 — countIn은 sel이 있으면 그 태그를 공부한 날만 ---------- */
  const daysIn = (s: MemberStat, pred: (day: string) => boolean): number => {
    let n = 0;
    for (const day of s.days) if (pred(day)) n++;
    return n;
  };
  const countIn = (s: MemberStat, pred: (day: string) => boolean): number => {
    if (!sel) return daysIn(s, pred);
    let n = 0;
    for (const [day, tags] of s.tags) if (pred(day) && tags.includes(sel)) n++;
    return n;
  };
  const dayBg = (s: MemberStat, day: string): string => {
    if (!s.days.has(day)) return '#F5F6F8';
    if (!selCell) return '#FFB800';
    return s.tags.get(day)?.includes(sel!) ? selCell : '#E9EBEF';
  };

  const monthPred = (day: string) => day.startsWith(gm.mk + '-');
  const suffix = sel ? `${sel} 공부한 날` : '공부한 날';

  /* 이 달에 (필터 기준으로) 공부한 날짜들 — 잔디 칸 색과 낭독 라벨이 같은 목록을 쓴다.
     격자는 aria-hidden이 아니라 role="img"다: 합계만 읽어 주면 "어떤 날들인가"라는
     이 화면의 본론이 낭독에서 통째로 사라진다. */
  const monthDayNums = (s: MemberStat): number[] => {
    const out: number[] = [];
    for (let d = 1; d <= gm.dim; d++) {
      const day = `${gm.mk}-${pad2(d)}`;
      if (!s.days.has(day)) continue;
      if (sel && !s.tags.get(day)?.includes(sel)) continue;
      out.push(d);
    }
    return out;
  };
  const dayListLabel = (name: string, nums: number[]): string =>
    `${name} ${suffix} ${nums.length}일`
    + (nums.length > 0 ? ` — ${nums.map((d) => `${d}일`).join(', ')}` : '');

  /* ---------- 크루 줄 세우기 — 자리는 무필터 "공부한 날" 순으로 고정 ----------
     태그를 누를 때 행이 그 태그 순으로 다시 서면 눈이 따라가던 사람을 잃는다.
     자리는 그대로 두고 숫자와 칸 색만 필터를 따른다; 동률은 크루 고정 순서(sort는 안정적). */
  const crewMonth = stats
    .map((s) => ({ s, n: countIn(s, monthPred), base: daysIn(s, monthPred) }))
    .sort((a, b) => b.base - a.base);
  const crewAll = stats
    .map((s) => ({ s, n: countIn(s, () => true), base: s.days.size }))
    .sort((a, b) => b.base - a.base);
  const ranked = period === 'all' ? crewAll : crewMonth;
  // 1위는 자리가 아니라 지금 보이는 숫자의 최다 — 필터 중엔 그 태그의 1위다.
  // 동률은 앞 행(무필터 공부한 날이 많은 쪽)이 이긴다.
  const top = ranked.reduce((a, r) => (r.n > a.n ? r : a), ranked[0]!);
  const crewTotal = ranked.reduce((a, r) => a + r.n, 0);
  const crewAvg = Math.round(crewTotal / MEMBERS.length);
  const crewAllMax = Math.max(1, ...crewAll.map((r) => r.n));

  /* ---------- 나 × 전체 — 월별 요약 ---------- */
  const myMonths = monthKeysOf(mine.days, today).map((mk) => {
    const mi = monthInfoOf(mk, today);
    const n = countIn(mine, (day) => day.startsWith(mk + '-'));
    // 미래 날짜에 남긴 기록은 세지만 분모(지나간 날)는 넘지 못한다 — 막대가 트랙을 뚫으면 안 된다
    return { mi, n, pct: Math.min(100, Math.round((n / mi.upTo) * 100)) };
  });
  const allTotal = myMonths.reduce((a, r) => a + r.n, 0);
  // 기록을 "시작한" 달은 목록의 첫 행이 아니라 기록이 있는 가장 이른 달이다 —
  // 미래에만 기록이 있으면 목록은 이번 달부터 서지만 시작한 달은 그 미래 달이다.
  let firstRecMk: string | null = null;
  for (const d of mine.days) {
    const mk = d.slice(0, 7);
    if (!firstRecMk || mk < firstRecMk) firstRecMk = mk;
  }

  /* ---------- 크루 × 전체 — 기간 캡션 (미래 기록 달도 monthKeysOf가 이미 포함한다) ---------- */
  const unionDays = new Set<string>();
  for (const s of stats) for (const d of s.days) unionDays.add(d);
  const crewMks = monthKeysOf(unionDays, today);
  const firstLabel = monthInfoOf(crewMks[0]!, today).label;
  const lastLabel = monthInfoOf(crewMks[crewMks.length - 1]!, today).label;
  const crewRangeCap = crewMks.length > 1 ? `${firstLabel} – ${lastLabel}` : firstLabel;

  /* ---------- 연속 — 필터와 무관하게 늘 "공부한 날" 기준 ---------- */
  const curStreak = streakOf(mine.days, today);
  const maxStreak = maxStreakOf(mine.days);

  const avSize = desktop ? 26 : 24;

  /* 시트는 미래 날짜에도 기록을 남길 수 있고 그 날도 집계에 든다 — 세는 날이 안 보이면
     숫자가 틀려 보이므로, 아직 오지 않은 날이라도 기록이 있으면 칸에 색을 켠다.
     기록 없는 미래 날만 테두리 흰 칸("아직")이다. */
  const monthCell = (s: MemberStat, i: number, cls: string) => {
    const day = `${gm.mk}-${pad2(i + 1)}`;
    return s.days.has(day) || i < gm.upTo
      ? <div key={day} className={cls} style={{ background: dayBg(s, day) }} />
      : <div key={day} className={`${cls} future`} />;
  };

  const myDayNums = monthDayNums(mine);
  const heatGrid = (
    <div className="st-heat" role="img" aria-label={dayListLabel(gm.label, myDayNums)}>
      {Array.from({ length: gm.offset }, (_, i) => (
        <div key={`p${i}`} className="st-cell pad" />
      ))}
      {Array.from({ length: gm.dim }, (_, i) => monthCell(mine, i, 'st-cell'))}
    </div>
  );

  const mainCard = scope === 'me' && period !== 'all' ? (
    <section className="st-card">
      <div className="st-card-head">
        <span className="st-card-title">{gm.label} 잔디</span>
        <span className="st-card-cap">{suffix} {myDayNums.length}일</span>
      </div>
      <div className="st-week" aria-hidden="true">
        {W.map((w, i) => (
          <span key={w} className={'st-wd' + (i === 0 ? ' sun' : '')}>{w}</span>
        ))}
      </div>
      {heatGrid}
    </section>
  ) : scope === 'me' ? (
    <section className="st-card">
      <div className="st-card-head">
        <span className="st-card-title">월별 공부한 날</span>
        <span className="st-card-cap">누적 {allTotal}일</span>
      </div>
      <div className="st-mon-list">
        {myMonths.map((r) => (
          <div key={r.mi.mk} className="st-mon-row">
            <span className="st-mon-label">{r.mi.label}</span>
            <div className="st-bar">
              <div className="st-bar-fill"
                style={{ width: `${r.pct}%`, background: selCell ?? '#FFB800' }} />
            </div>
            <span className="st-mon-val">
              {r.n}일 <span className="st-mon-dim">/ {r.mi.upTo}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="st-foot">
        {firstRecMk
          ? `${monthInfoOf(firstRecMk, today).label}부터 기록을 시작했어요`
          : '아직 기록이 없어요'}
      </div>
    </section>
  ) : period !== 'all' ? (
    <section className="st-card">
      <div className="st-card-head">
        <span className="st-card-title">{gm.label} 크루 잔디</span>
        <span className="st-card-cap">{sel ? `색 칸 = ${sel} 공부한 날` : '색 칸 = 공부한 날'}</span>
      </div>
      <div className="st-crew">
        {crewMonth.map(({ s, n }) => (
          <div key={s.m.id} className="st-crew-row">
            <div className="st-crew-head">
              <Avatar m={s.m} size={avSize} />
              <span className="st-crew-nm">{s.m.name}</span>
              {s.m.id === meId && <MeBadge />}
              <span className="st-crew-n">{n}일</span>
            </div>
            <div className="st-strip" role="img"
              aria-label={dayListLabel(`${gm.label} ${s.m.name}`, monthDayNums(s))}>
              {Array.from({ length: gm.dim }, (_, i) => monthCell(s, i, 'st-strip-cell'))}
            </div>
          </div>
        ))}
      </div>
    </section>
  ) : (
    <section className="st-card">
      <div className="st-card-head">
        <span className="st-card-title">크루 누적 공부한 날</span>
        <span className="st-card-cap">{crewRangeCap}</span>
      </div>
      <div className="st-crew">
        {crewAll.map(({ s, n }) => (
          <div key={s.m.id} className="st-bar-row">
            <Avatar m={s.m} size={avSize} />
            <span className="st-bar-nm">{s.m.name}</span>
            {s.m.id === meId && <MeBadge />}
            <div className="st-bar">
              <div className="st-bar-fill"
                style={{ width: `${Math.round((n / crewAllMax) * 100)}%`, background: s.m.color }} />
            </div>
            <span className="st-bar-n">{n}일</span>
          </div>
        ))}
      </div>
    </section>
  );

  const tagCard = (
    <section className="st-card st-tag-card">
      <div className="st-card-title">{scope === 'crew' ? '태그 비중 — 크루 합계' : '태그 비중'}</div>
      {legendTags.length === 0 ? (
        <div className="st-tag-empty">이 기간에는 태그가 붙은 기록이 없어요</div>
      ) : (
        <>
          <div className="st-segs">
            {legendTags.map((t) => (
              <button key={t} type="button" className="st-seg"
                aria-label={`${t} ${counts.get(t)}일`} aria-pressed={sel === t}
                style={{ flexGrow: counts.get(t), background: tagLook(t).sw, opacity: dimOf(t) }}
                onClick={() => toggleTag(t)} />
            ))}
          </div>
          {desktop ? (
            <div className="st-legend">
              {legendTags.map((t) => {
                const n = counts.get(t)!;
                const look = tagLook(t);
                return (
                  <button key={t} type="button" className="st-legend-row" aria-pressed={sel === t}
                    style={{ borderColor: sel === t ? look.sw : undefined, opacity: dimOf(t) }}
                    onClick={() => toggleTag(t)}>
                    <span className="st-dot" style={{ background: look.sw }} />
                    <span className="st-legend-nm">{t}</span>
                    <span className="st-legend-sp" />
                    <span className="st-legend-n">{n}일</span>
                    <span className="st-legend-pct">{Math.round((n / tagTotal) * 100)}%</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="st-legend-chips">
              {legendTags.map((t) => {
                const look = tagLook(t);
                return (
                  <button key={t} type="button" className="st-chip" aria-pressed={sel === t}
                    style={{ borderColor: sel === t ? look.sw : undefined, opacity: dimOf(t) }}
                    onClick={() => toggleTag(t)}>
                    <span className="st-dot" style={{ background: look.sw }} />
                    <span className="st-chip-nm">{t}</span>
                    <span className="st-chip-n">{counts.get(t)}일</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="st-hint">태그를 눌러 확인</div>
        </>
      )}
    </section>
  );

  const streakNote = '기록 또는 체크인 도장이 있는 날 기준';
  const topLabel = period === 'all' ? '누적 1위' : `${gm.label} 1위`;
  const sideCard = scope === 'me' ? (
    desktop ? (
      <section className="st-card">
        <div className="st-streak-cols">
          <div className="st-streak-col">
            <div className="st-stat-label">연속</div>
            <div className="st-stat-val">{curStreak}일</div>
          </div>
          <div className="st-streak-div" />
          <div className="st-streak-col">
            <div className="st-stat-label">최장 연속</div>
            <div className="st-stat-val">{maxStreak}일</div>
          </div>
        </div>
        <div className="st-hint">{streakNote}</div>
      </section>
    ) : (
      <div>
        <div className="st-duo">
          <div className="st-card st-duo-card">
            <div className="st-stat-label">연속</div>
            <div className="st-stat-val">{curStreak}일</div>
          </div>
          <div className="st-card st-duo-card">
            <div className="st-stat-label">최장 연속</div>
            <div className="st-stat-val">{maxStreak}일</div>
          </div>
        </div>
        <div className="st-duo-note">{streakNote}</div>
      </div>
    )
  ) : top.n === 0 ? (
    // 전원 0일 — 고정 순서의 첫 사람을 1위로 세우면 없는 우승을 지어내는 셈이다
    <section className="st-card">
      <div className="st-stat-label">{topLabel}</div>
      <div className="st-top-empty">아직 공부한 날이 없어요</div>
    </section>
  ) : desktop ? (
    <section className="st-card">
      <div className="st-stat-label">{topLabel}</div>
      <div className="st-top-row">
        <Avatar m={top.s.m} size={34} />
        <div>
          <div className="st-top-nm">{top.s.m.name}</div>
          <div className="st-top-days">{top.n}일 공부</div>
        </div>
      </div>
      <div className="st-top-foot">크루 합계 {crewTotal}일 · 1인 평균 {crewAvg}일</div>
    </section>
  ) : (
    <section className="st-card st-top-m">
      <Avatar m={top.s.m} size={30} />
      <div className="st-top-m-main">
        <div className="st-stat-label">{topLabel}</div>
        <div className="st-top-m-nm">{top.s.m.name} <span>{top.n}일</span></div>
      </div>
      <div className="st-top-m-agg">합계 {crewTotal}일<br />평균 {crewAvg}일</div>
    </section>
  );

  return (
    <div className="stats-wrap">
      <div className="st-head">
        <h2 className="st-title">통계</h2>
        <div className="st-scope" role="group" aria-label="통계 범위">
          <button type="button" className={'st-scope-btn' + (scope === 'me' ? ' on' : '')}
            aria-pressed={scope === 'me'} onClick={() => onScope('me')}>나</button>
          <button type="button" className={'st-scope-btn' + (scope === 'crew' ? ' on' : '')}
            aria-pressed={scope === 'crew'} onClick={() => onScope('crew')}>크루</button>
        </div>
      </div>
      <div className="st-tabs" role="group" aria-label="통계 기간">
        {([['cur', '이번 달'], ['prev', '지난 달'], ['all', '전체']] as const).map(([p, label]) => (
          <button key={p} type="button" className={'st-tab' + (period === p ? ' on' : '')}
            aria-pressed={period === p} onClick={() => onPeriod(p)}>{label}</button>
        ))}
      </div>
      <div className="st-grid">
        <div className="st-main">{mainCard}</div>
        <div className="st-side">
          {tagCard}
          {sideCard}
        </div>
      </div>
    </div>
  );
}
