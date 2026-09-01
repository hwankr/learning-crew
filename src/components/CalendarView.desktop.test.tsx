/* 와이드(≥900px) 갈래 — 정적 마크업은 기본이 좁은 화면이라(useIsDesktop의 서버 스냅샷 = false)
   이 파일에서만 훅을 데스크톱으로 고정해 그 갈래를 렌더한다. 좁은 화면과 갈리는 것은
   머리 버튼 차례와 안내 문구뿐이다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrewEvent, Entry, MemberId, ReactionSet } from '../../shared/types';
import { COPY } from '../lib/constants';
import { CalendarView } from './CalendarView';

vi.mock('../lib/useMediaQuery', () => ({ useIsDesktop: () => true }));

const TODAY = '2026-08-16';

function entry(id: string, day: string): Entry {
  return {
    id, m: 'wg', day, time: '12:00', tag: '영어', tags: ['영어'], stars: 4, studyMinutes: null,
    memo: '', body: '', todos: [], photos: [],
    v: 0, updatedAt: '2026-08-16T03:00:00.000Z', deletedAt: null,
  };
}

function event(p: Partial<CrewEvent> & Pick<CrewEvent, 'id' | 'day'>): CrewEvent {
  return {
    m: 'sh', participants: ['sh'], title: '정보처리기사 실기', tag: '자격증', memo: '', endDay: null,
    v: 0, updatedAt: '2026-08-16T00:00:00.000Z', deletedAt: null, ...p,
  };
}

function props(opts: {
  entries?: Entry[]; events?: CrewEvent[]; selDay?: string; onSel?: (k: string) => void;
}) {
  return {
    entries: opts.entries ?? [], events: opts.events ?? [],
    selDay: opts.selDay ?? TODAY, setSelDay: opts.onSel ?? (() => {}),
    filterM: null as MemberId | null, setFilterM: () => {},
    todayKey: TODAY, meId: 'sh' as MemberId, editingId: null,
    comments: new Map<string, never[]>(), reactions: new Map<string, ReactionSet[]>(),
    photoUploads: new Map(), wit: COPY, actions: {} as never,
    onOpenEventSheet: () => {}, onOpenCompose: () => {}, onDeleteEvent: () => {},
  };
}

function view(opts: Parameters<typeof props>[0]): string {
  return renderToStaticMarkup(<CalendarView {...props(opts)} />);
}

describe('와이드 셀의 일정 알약·기록 글줄', () => {
  it('일정이 셀에 제목 알약으로 서고, 점 줄은 그리지 않는다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18', title: '정보처리기사 실기' })] });
    // 선택일(오늘)이 아닌 날의 일정 — 제목이 서는 자리는 셀 알약 하나뿐
    expect(html.split('정보처리기사 실기').length - 1).toBe(1);
    expect(html).toContain('cal-cell-ev near');
    expect(html).not.toContain('cal-day-dot');
  });

  it('기간 일정은 걸친 날마다 알약이 선다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18', endDay: '2026-08-20' })] });
    expect(html.split('cal-cell-ev').length - 1).toBe(3);
  });

  // 태그는 싣지 않는다 — 42칸에서 줄이 소란해지고, 무엇을 했는지는 선택일 패널이 말한다
  it('기록은 이름만의 글줄로 선다', () => {
    const html = view({ entries: [entry('e1', '2026-08-14')] });
    expect(html).toContain('cal-cell-en');
    expect(html).toContain('<span class="cal-cell-en-text">웅</span>');
  });

  // 일정이 기록보다 먼저다 — 약속이 먼저 보인다. 넘치면 마지막 줄을 "+N"에 내준다.
  it('항목 예산(3줄)을 넘치면 일정부터 채우고 "+N"으로 접는다', () => {
    const html = view({
      events: [event({ id: 'a', day: TODAY, title: '면접' })],
      entries: [
        entry('e1', TODAY),
        { ...entry('e2', TODAY), m: 'th' as const },
        { ...entry('e3', TODAY), m: 'jj' as const },
      ],
    });
    expect(html.split('cal-cell-ev').length - 1).toBe(1);
    expect(html.split('cal-cell-en"').length - 1).toBe(1);
    expect(html).toContain('+2');
  });

  it('딱 3개면 접지 않고 다 세운다', () => {
    const html = view({
      events: [
        event({ id: 'a', day: '2026-08-18', title: '가' }),
        event({ id: 'b', day: '2026-08-18', title: '나' }),
        event({ id: 'c', day: '2026-08-18', title: '다' }),
      ],
    });
    expect(html.split('cal-cell-ev').length - 1).toBe(3);
    expect(html).not.toContain('cal-cell-more');
  });
});

describe('와이드 캘린더의 머리·선택일', () => {
  // 배너는 걷어냈다 — 와이드에서도 격자 위에 아무것도 세우지 않는다
  it('격자 위에 배너도 라벨도 그리지 않는다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18' })] });
    expect(html).not.toContain('cal-banner');
    expect(html).not.toContain('cal-top-label');
  });

  it('머리 버튼 차례가 좁은 화면과 반대다(일정 등록 → 오늘)', () => {
    const html = view({});
    expect(html.indexOf('cal-event-btn')).toBeLessThan(html.indexOf('cal-today-btn'));
  });

  it('안내 문구는 마우스의 말을 쓰고, 빈 날 문구도 와이드 것이다', () => {
    const html = view({});
    expect(html).toContain('날짜를 눌러 상세 보기');
    expect(html).toContain(COPY.calEmpty);
    expect(html).not.toContain(COPY.calEmptyDay);
  });

  // 격자 셀은 두 셸이 같다 — 낭독기 이름도 와이드에서 그대로 붙는다
  it('셀 이름은 와이드에서도 그 날의 수를 말한다', () => {
    const html = view({ entries: [entry('e1', TODAY)] });
    expect(html).toContain('aria-label="8월 16일, 기록 1개"');
  });
});
