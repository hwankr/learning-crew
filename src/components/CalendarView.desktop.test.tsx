/* 와이드(≥900px) 갈래 — 정적 마크업은 기본이 좁은 화면이라(useIsDesktop의 서버 스냅샷 = false)
   이 파일에서만 훅을 데스크톱으로 고정해 그 갈래를 렌더한다. 좁은 화면과 갈리는 것은 셋뿐이다:
   격자 위 배너에 무엇을 세우는가(topEventOf), 그 위 라벨 한 줄, 그리고 머리 버튼 차례. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrewEvent, Entry, MemberId, ReactionSet } from '../../shared/types';
import { COPY } from '../lib/constants';
import { CalendarView } from './CalendarView';

vi.mock('../lib/useMediaQuery', () => ({ useIsDesktop: () => true }));

const TODAY = '2026-08-16';

function entry(id: string, day: string): Entry {
  return {
    id, m: 'wg', day, time: '12:00', tag: '영어', tags: ['영어'], stars: 4,
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

/* 클릭까지 보려면 핸들러가 붙은 요소가 필요한데 정적 마크업에는 핸들러가 없다.
   훅을 고정한 이 파일에서 CalendarView는 훅이 하나도 남지 않는 순수 함수라(상태는 전부 App이
   든다) 그대로 호출해 요소 트리를 얻을 수 있다 — 렌더러 없이 배너의 onClick을 직접 부른다. */
function findByClass(node: unknown, prefix: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByClass(child, prefix);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const el = node as { props?: Record<string, unknown> };
  if (!el.props) return null;
  const cls = el.props.className;
  if (typeof cls === 'string' && cls.startsWith(prefix)) return { props: el.props };
  return findByClass(el.props.children, prefix);
}

describe('와이드 캘린더의 배너', () => {
  it('고른 날에 일정이 있으면 그 일정을 "이 날의 일정"으로 세운다', () => {
    const html = view({
      events: [
        event({ id: 'a', day: '2026-08-18', title: '정보처리기사 실기' }),
        event({ id: 'b', day: TODAY, title: '면접' }),
      ],
    });
    expect(html).toContain('이 날의 일정');
    expect(html).not.toContain('다가오는 일정');
    // 배너에 선 것은 고른 날(오늘)의 일정이다 — 더 이른 다음 일정이 아니다
    expect(html).toContain('<span class="cal-banner-title">면접</span>');
  });

  it('고른 날이 비었으면 다가오는 일정으로 되돌아간다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18' })] });
    expect(html).toContain('다가오는 일정');
    expect(html).toContain('<span class="cal-banner-title">정보처리기사 실기</span>');
    expect(html).toContain('cal-banner near');
  });

  it('세울 일정이 없으면 배너도 라벨도 그리지 않는다', () => {
    const html = view({ entries: [entry('e1', TODAY)] });
    expect(html).not.toContain('cal-banner');
    expect(html).not.toContain('cal-top-label');
  });

  it('배너를 누르면 그 일정의 시작일이 골라진다', () => {
    const picked: string[] = [];
    const tree = CalendarView(props({
      // 기간 일정 — 고른 날(오늘)과도, 걸친 날들과도 다른 "시작일"로 가야 한다
      events: [event({ id: 'a', day: '2026-08-24', endDay: '2026-08-27', title: '기말고사' })],
      onSel: (k) => picked.push(k),
    }));
    const banner = findByClass(tree, 'cal-banner');
    expect(banner).not.toBeNull();
    (banner!.props.onClick as () => void)();
    expect(picked).toEqual(['2026-08-24']);
  });
});

describe('와이드 캘린더의 머리·선택일', () => {
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
