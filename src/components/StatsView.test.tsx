/* 통계 화면의 경계 — 미래 날짜 기록의 표시·분모, 전원 0일의 1위, 태그 필터의 파생 해제,
   잔디의 낭독 라벨. 코덱스 리뷰가 잡은 자리들이라 다시 무너지면 안 된다.
   정적 마크업은 늘 좁은 화면이다(useIsDesktop의 서버 스냅샷 = false) — 여기 보이는 것은
   모바일 셸이고, 스코프·기간·필터는 App이 드는 상태라 값을 그대로 넣어 준다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Entry, Tag } from '../../shared/types';
import { StatsView, type StatPeriod, type StatScope } from './StatsView';

function entry(id: string, day: string, tags: Tag[] = ['영어']): Entry {
  return {
    id, m: 'sh', day, time: '12:00', tag: tags[0] ?? '기타', tags, stars: 4,
    memo: '', body: '', todos: [], photos: [],
    v: 0, updatedAt: '2026-08-16T03:00:00.000Z', deletedAt: null,
  };
}

function view(opts: {
  entries?: Entry[]; scope?: StatScope; period?: StatPeriod; rawSel?: Tag | null; today?: Date;
}): string {
  const today = opts.today ?? new Date(2026, 7, 16); // 2026-08-16 (로컬)
  return renderToStaticMarkup(
    <StatsView entries={opts.entries ?? []} studyDays={{}} statuses={{}} meId="sh"
      now={today.getTime()} today={today}
      scope={opts.scope ?? 'me'} period={opts.period ?? 'cur'} rawSel={opts.rawSel ?? null}
      onScope={() => {}} onPeriod={() => {}} onSel={() => {}} />,
  );
}

describe('통계 잔디와 집계', () => {
  it('미래 날짜의 기록도 칸에 색이 켜진다 — 세는 날이 안 보이면 숫자가 틀려 보인다', () => {
    const html = view({ entries: [entry('a', '2026-08-20')] });
    // 8월 31일 중 16일까지 지났고 20일에 기록 — 기록 없는 미래 날 14칸만 "아직" 흰 칸
    expect(html.split('st-cell future').length - 1).toBe(14);
    expect(html).toContain('공부한 날 1일');
  });

  it('미래 기록이 분모(지나간 날)를 넘어도 막대는 트랙을 넘지 않는다', () => {
    const html = view({
      period: 'all', today: new Date(2026, 7, 1),
      entries: [entry('a', '2026-08-01'), entry('b', '2026-08-20')],
    });
    expect(html).toContain('누적 2일'); // 미래 기록도 세지만
    expect(html).toContain('width:100%'); // 2일 / 1일이 200%로 그려지면 안 된다
    expect(html).not.toContain('width:200%');
  });

  it('잔디는 합계만이 아니라 어떤 날들인지 낭독 라벨로 말한다', () => {
    const html = view({ entries: [entry('a', '2026-08-03'), entry('b', '2026-08-05')] });
    expect(html).toContain('8월 공부한 날 2일 — 3일, 5일');
  });

  it('미래 달의 기록도 월별 행으로 서서 누적과 어긋나지 않는다', () => {
    const html = view({
      period: 'all', entries: [entry('a', '2026-08-10'), entry('b', '2026-09-05')],
    });
    expect(html).toContain('누적 2일');
    expect(html).toContain('9월'); // 세는 달이 목록에 없으면 월별 합과 누적이 갈라진다
    expect(html).toContain('8월부터 기록을 시작했어요');
  });

  it('미래에만 기록이 있으면 시작한 달도 그 달이다', () => {
    const html = view({ period: 'all', entries: [entry('a', '2026-09-05')] });
    expect(html).toContain('누적 1일');
    expect(html).toContain('9월부터 기록을 시작했어요'); // 목록 첫 행(8월 0일)이 아니라
  });

  it('크루 누적 캡션도 미래 기록 달까지 말한다', () => {
    const html = view({
      scope: 'crew', period: 'all',
      entries: [entry('a', '2026-07-10'), entry('b', '2026-09-05')],
    });
    expect(html).toContain('7월 – 9월');
  });

  it('크루 스트립도 미래 기록 칸과 낭독 라벨을 같이 든다', () => {
    const html = view({
      scope: 'crew', entries: [entry('a', '2026-08-10'), entry('b', '2026-08-20')],
    });
    // 승환 스트립은 기록 없는 미래 날 14칸, 나머지 넷은 15칸씩
    expect(html.split('st-strip-cell future').length - 1).toBe(14 + 15 * 4);
    expect(html).toContain('8월 승환 공부한 날 2일 — 10일, 20일');
  });
});

describe('통계 1위 카드', () => {
  it('전원 0일이면 1위를 지어내지 않는다', () => {
    const html = view({ scope: 'crew' });
    expect(html).toContain('아직 공부한 날이 없어요');
    expect(html).not.toContain('st-top-m-nm'); // 이름 카드가 서지 않는다
  });

  it('기록이 있으면 가장 많은 사람이 1위로 선다', () => {
    const html = view({
      scope: 'crew',
      entries: [entry('a', '2026-08-10'), entry('b', '2026-08-11'), { ...entry('c', '2026-08-10'), m: 'wg' }],
    });
    expect(html).not.toContain('아직 공부한 날이 없어요');
    expect(html).toContain('st-top-m-nm">승환'); // 2일 > 1일 — 이름까지 맞아야 한다
  });
});

describe('통계 태그 필터', () => {
  it('고른 태그를 공부한 날만 그 색으로 남고 나머지 공부한 날은 바랜다', () => {
    const html = view({
      rawSel: '영어',
      entries: [entry('a', '2026-08-10', ['영어']), entry('b', '2026-08-12', ['자격증'])],
    });
    // 칸 색은 잔디 셀에서 본다 — 같은 색이 범례 점에도 있어 셀렉터까지 맞춰야 한다
    expect(html).toContain('class="st-cell" style="background:#2E90FA"'); // 영어 칸
    expect(html).toContain('class="st-cell" style="background:#E9EBEF"'); // 다른 공부한 날은 바랜다
    expect(html).toContain('영어 공부한 날 1일');
  });

  it('태그를 눌러도 크루 줄은 다시 서지 않는다 — 자리는 공부한 날 순 그대로', () => {
    const html = view({
      scope: 'crew', rawSel: '자격증',
      entries: [
        entry('a', '2026-08-10', ['영어']), entry('b', '2026-08-11', ['영어']), // 승환 2일 — 자격증 0
        { ...entry('c', '2026-08-12', ['자격증']), m: 'wg' }, // 웅 1일 — 자격증 1
      ],
    });
    expect(html.indexOf('승환')).toBeLessThan(html.indexOf('웅')); // 눈이 따라가던 자리는 그대로
    expect(html).toContain('st-top-m-nm">웅'); // 1위 카드는 지금 보이는 숫자(필터)의 최다
  });

  it('범위·기간을 옮겨 고른 태그가 목록에 없으면 필터는 파생적으로 풀린다', () => {
    const html = view({ rawSel: '자격증', entries: [entry('a', '2026-08-10', ['영어'])] });
    // 자격증 기록이 없는데 필터가 살아 있으면 잔디가 온통 회색으로 죽는다
    expect(html).toContain('class="st-cell" style="background:#FFB800"');
    expect(html).not.toContain('background:#E9EBEF');
  });
});
