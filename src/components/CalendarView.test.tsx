/* 캘린더에 실린 일정 — 셀·선택일 패널이 같은 일정을 같은 자리에 그리는지.
   특히 기간 일정은 시작일에만 찍히면 시험 기간이 하루로 읽히고, 알약 예산(3)을 기록과
   나눠 쓰지 않으면 그 날의 약속이 "+N개 더" 뒤로 숨는다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CrewEvent, Entry, MemberId } from '../../shared/types';
import { COPY } from '../lib/constants';
import {
  CalendarView, entriesOfMember, eventsOfMember, headActionOrder, topEventOf,
} from './CalendarView';
import { ComposeMenu } from './ComposeMenu';

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

/* 정적 마크업은 늘 좁은 화면이다(useIsDesktop의 서버 스냅샷 = false) — 이 파일이 보는 것은
   모바일 셸의 캘린더다. 데스크톱에만 서는 노드(오른쪽 열의 일정 카드)는 여기 없다.
   멤버 필터는 App이 드는 상태라 여기서는 값을 그대로 넣어 준다(기본은 전체 = null). */
function view(opts: {
  entries?: Entry[]; events?: CrewEvent[]; selDay?: string; filterM?: MemberId | null;
}): string {
  return renderToStaticMarkup(
    <CalendarView entries={opts.entries ?? []} events={opts.events ?? []}
      selDay={opts.selDay ?? TODAY} setSelDay={() => {}}
      filterM={opts.filterM ?? null} setFilterM={() => {}} todayKey={TODAY} meId="sh"
      editingId={null} comments={new Map()} reactions={new Map()} photoUploads={new Map()}
      wit={COPY} actions={{} as never}
      onOpenEventSheet={() => {}} onOpenCompose={() => {}} onDeleteEvent={() => {}} />,
  );
}

describe('캘린더의 일정', () => {
  it('기간 일정은 걸친 모든 날의 셀에 선다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18', endDay: '2026-08-20' })] });
    // 알약은 셀마다 하나씩 — 사흘이면 세 번. 제목 자체는 배너에도 한 번 더 실린다
    expect(html.split('class="cal-pill ev').length - 1).toBe(3);
    expect(html.split('정보처리기사 실기').length - 1).toBe(4);
  });

  it('임박한 일정과 지난 일정이 다른 옷을 입는다', () => {
    expect(view({ events: [event({ id: 'a', day: '2026-08-19' })] })).toContain('cal-pill ev near');
    expect(view({ events: [event({ id: 'a', day: '2026-08-10' })] })).toContain('cal-pill ev past');
    expect(view({ events: [event({ id: 'a', day: '2026-08-10' })] })).toContain('지남');
  });

  /* 시험 6일째 알약이 'D+6 정보처리기사 실기'로 서면 이미 끝난 일처럼 읽힌다 —
     격자 알약과 선택일 패널 행이 함께 "진행 중"이라 말하고 임박과 같은 노란 옷을 입는다. */
  it('진행 중인 기간 일정은 셀·패널 모두에서 "진행 중"이고 임박 옷을 입는다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-10', endDay: '2026-08-20' })] });
    expect(html).toContain('cal-pill ev near');
    expect(html).toContain('sel-event-dday near');
    expect(html).toContain('진행 중');
    expect(html).not.toContain('D+');
  });

  // 알약 예산은 셋뿐이다 — 일정이 먼저 서고 남는 자리를 기록이 받는다
  it('일정이 기록보다 앞서 알약 자리를 가져간다', () => {
    const html = view({
      events: [event({ id: 'a', day: TODAY, title: '면접' })],
      entries: [entry('e1', TODAY), entry('e2', TODAY), entry('e3', TODAY)],
    });
    expect(html).toContain('면접');
    expect(html).toContain('+1개 더');
  });

  it('선택일 패널이 일정 수를 병기하고 내 일정에만 삭제를 연다', () => {
    const mine = view({ events: [event({ id: 'a', day: TODAY, m: 'sh' })] });
    expect(mine).toContain('일정 1개');
    expect(mine).toContain('sel-event-del');
    expect(view({ events: [event({ id: 'a', day: TODAY, m: 'wg' })] })).not.toContain('sel-event-del');
  });

  /* 범례 밑선이 격자와 선택일 섹션을 가르는 구분선이다 — 좁은 화면에서는 일정이 없는 달에도
     선다(디자인). 통째로 접으면 안내와 함께 그 선까지 사라져 두 섹션이 붙어 버린다. */
  it('일정이 없는 달에도 좁은 화면의 범례 행은 선다', () => {
    expect(view({ events: [event({ id: 'a', day: TODAY })] })).toContain('cal-legend');
    const noEvents = view({ entries: [entry('e1', TODAY)] });
    expect(noEvents).toContain('cal-legend');
    expect(noEvents).toContain('터치하여 상세 보기');
  });
});

/* 참여 인원 — 셋이 함께 치는 시험이 등록자 한 사람의 일로 보이면 나머지 둘은 제 캘린더에서
   그 날을 놓친다. 셀 점·패널 행이 등록자가 아니라 참여자를 센다. */
describe('캘린더의 참여 인원', () => {
  /** 모바일 셀의 네모 점(cal-day-dot ev)에 쓰인 색만 순서대로 */
  function eventDots(html: string): string[] {
    return [...html.matchAll(/class="cal-day-dot ev" style="background:(#[0-9A-F]{6})"/g)]
      .map((m) => m[1]!);
  }

  it('셀의 네모 점은 일정 하나가 아니라 참여자 한 사람씩이다', () => {
    // 승환(#FFB800)·웅(#12B76A)·태현(#2E90FA)이 함께 치는 시험 하나 → 점 셋
    const html = view({ events: [event({ id: 'a', day: TODAY, participants: ['sh', 'wg', 'th'] })] });
    expect(eventDots(html)).toEqual(['#FFB800', '#12B76A', '#2E90FA']);
  });

  it('같은 사람이 그 날 일정 둘에 들어도 네모 점은 하나다', () => {
    const html = view({ events: [
      event({ id: 'a', day: TODAY, participants: ['sh', 'wg'] }),
      event({ id: 'b', day: TODAY, title: '면접', participants: ['wg'] }),
    ] });
    expect(eventDots(html)).toEqual(['#FFB800', '#12B76A']);
  });

  // 알약은 일정당 하나라 점도 하나 — 대표는 크루 차례 첫 사람이다(등록자가 아니다)
  it('데스크톱 알약의 점은 대표 참여자 색이다', () => {
    const html = view({ events: [event({ id: 'a', day: TODAY, m: 'kj', participants: ['wg', 'th'] })] });
    expect(html).toContain('class="cal-pill-dot" style="background:#12B76A"');
  });

  it('선택일 패널 행은 아바타 스택과 이름 요약으로 참여자를 말한다', () => {
    const three = view({ events: [event({ id: 'a', day: TODAY, participants: ['sh', 'wg', 'th'] })] });
    expect(three).toContain('sel-event-avatars');
    expect(three).toContain('승환 외 2 · 일정');
    const two = view({ events: [event({ id: 'a', day: TODAY, participants: ['sh', 'wg'] })] });
    expect(two).toContain('승환·웅 · 일정');
  });

  // 참여자를 모르던 시절의 행(빈 배열)도 등록자 하나로 자연스럽게 선다
  it('참여자가 비어 있어도 등록자로 되살아난다', () => {
    const html = view({ events: [event({ id: 'a', day: TODAY, m: 'kj', participants: [] })] });
    expect(eventDots(html)).toEqual(['#9E77ED']);
    expect(html).toContain('경진 · 일정');
  });
});

/* 멤버 필터 — 다섯 명의 점이 한 격자에 겹치면 내 것을 찾기가 어렵다.
   거르는 기준이 기록과 일정에서 서로 달라야 한다: 일정은 등록자가 아니라 참여자다. */
describe('캘린더의 멤버 필터', () => {
  it('전체(null)는 그대로 두고, 고른 멤버의 기록만 남긴다', () => {
    const list = [entry('e1', TODAY), { ...entry('e2', TODAY), m: 'sh' as const }];
    expect(entriesOfMember(list, null)).toHaveLength(2);
    expect(entriesOfMember(list, 'sh').map((e) => e.id)).toEqual(['e2']);
  });

  // 남이 등록해 준 시험도 내가 치는 것이면 내 달력에 남아야 한다
  it('일정은 등록자가 아니라 참여자로 거른다', () => {
    const evs = [
      event({ id: 'a', day: TODAY, m: 'sh', participants: ['wg', 'th'] }),
      event({ id: 'b', day: TODAY, m: 'sh', participants: ['sh'] }),
    ];
    expect(eventsOfMember(evs, 'wg').map((e) => e.id)).toEqual(['a']);
    expect(eventsOfMember(evs, 'sh').map((e) => e.id)).toEqual(['b']);
    expect(eventsOfMember(evs, null)).toHaveLength(2);
  });

  it('참여자가 비어 있는 옛 일정은 등록자의 것으로 걸린다', () => {
    const evs = [event({ id: 'a', day: TODAY, m: 'kj', participants: [] })];
    expect(eventsOfMember(evs, 'kj').map((e) => e.id)).toEqual(['a']);
    expect(eventsOfMember(evs, 'wg')).toHaveLength(0);
  });

  it('칩 행은 전체 + 크루 다섯이고 기본은 전체다', () => {
    const html = view({});
    expect(html).toContain('cal-filter-chip on');
    for (const name of ['전체', '승환', '웅', '태현', '진주', '경진']) {
      expect(html).toContain(`${name}</button>`);
    }
    // 켜진 칩은 하나뿐 — 처음 상태에서 사람 칩이 켜져 있으면 격자가 이미 걸러져 있다
    expect(html.split('cal-filter-chip on').length - 1).toBe(1);
  });

  /* 필터 값은 App이 들고 내려 준다(셸이 갈려도 살아남게) — 내려온 값이 격자에 그대로 닿는지.
     시드 기록은 웅(#12B76A)의 것이라, 승환만 켜면 그 날의 점이 사라져야 한다. */
  it('내려받은 필터 값이 격자 점에 그대로 적용된다', () => {
    const wgDot = 'class="cal-day-dot" style="background:#12B76A"';
    expect(view({ entries: [entry('e1', TODAY)] })).toContain(wgDot);
    expect(view({ entries: [entry('e1', TODAY)], filterM: 'sh' })).not.toContain(wgDot);
    expect(view({ entries: [entry('e1', TODAY)], filterM: 'wg' })).toContain(wgDot);
  });
});

/* 좁은 화면의 머리·배너·작성 입구 — 이미지 기준 리디자인.
   격자 위에 서는 것들이라 하나가 어긋나면 그 아래 전부가 밀린다. */
describe('모바일 캘린더의 머리와 배너', () => {
  it('머리에 크루 배지와 기록·일정 수가 함께 선다', () => {
    const html = view({
      entries: [entry('e1', TODAY), entry('e2', '2026-08-02')],
      events: [event({ id: 'a', day: '2026-08-18' })],
    });
    expect(html).toContain('cal-crew-badge');
    expect(html).toContain('러닝 크루');
    expect(html).toContain('기록 2개');
    expect(html).toContain('일정 1개');
  });

  /* 머리의 버튼은 오늘 → + 차례로 보인다(이미지). CSS order로 자리만 바꾸면 Tab 차례가
     화면과 어긋나므로 DOM 자체가 그 차례여야 한다. */
  it('머리의 버튼 차례가 화면 차례(오늘 → 일정 등록)와 같다', () => {
    const html = view({});
    expect(html.indexOf('cal-today-btn')).toBeGreaterThan(-1);
    expect(html.indexOf('cal-today-btn')).toBeLessThan(html.indexOf('cal-event-btn'));
    expect(html).not.toContain('order:');
  });

  /* 차례는 셸마다 뒤집히지만 id는 의미에 고정된다 — 이 id가 곧 React key다.
     key가 자리(index)를 따라가면 900px 경계를 넘는 리사이즈에서 React가 노드를 재사용해
     '오늘'에 두었던 초점이 그대로 '일정 등록' 버튼이 된다(누르는 것이 달라진다). */
  it('셸마다 차례만 뒤집히고 버튼 id(=key)는 그대로다', () => {
    expect(headActionOrder(false)).toEqual(['today', 'event']);
    expect(headActionOrder(true)).toEqual(['event', 'today']);
    expect([...headActionOrder(true)].sort()).toEqual([...headActionOrder(false)].sort());
  });

  // 걸치기만 해도 이 달의 일정이다 — 7월에 시작해 8월까지 가는 시험은 8월에도 세어야 한다
  it('달을 걸친 기간 일정도 그 달의 일정으로 센다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-07-28', endDay: '2026-08-03' })] });
    expect(html).toContain('일정 1개');
  });

  it('다가오는 일정이 D-day 배너로 서고 참여자·날짜를 말한다', () => {
    const html = view({
      events: [event({ id: 'a', day: '2026-08-18', title: '정보처리기사 실기', participants: ['jj'] })],
    });
    expect(html).toContain('cal-banner near');
    expect(html).toContain('D-2');
    expect(html).toContain('진주 · 8월 18일 (화)');
  });

  it('남은 일정이 없으면 배너를 접는다', () => {
    expect(view({ events: [event({ id: 'a', day: '2026-08-10' })] })).not.toContain('cal-banner');
    expect(view({})).not.toContain('cal-banner');
  });
});

describe('선택일 섹션', () => {
  it('선택일 머리의 입구는 두 셸 모두 "+ 작성하기"다', () => {
    const html = view({});
    expect(html).toContain('sel-compose');
    expect(html).toContain('+ 작성하기');
    expect(html).not.toContain('sel-event-add');
  });

  it('아무것도 없는 날은 기록·일정을 함께 말하는 문구가 선다', () => {
    expect(view({})).toContain(COPY.calEmptyDay);
  });

  // 일정만 있는 날에 "없습니다"가 함께 뜨면 바로 위 목록과 어긋난다
  it('일정만 있는 날에는 빈 문구를 그리지 않는다', () => {
    const html = view({ events: [event({ id: 'a', day: TODAY })] });
    expect(html).not.toContain(COPY.calEmptyDay);
    expect(html).toContain('기록 0개 · 일정 1개');
  });
});

/* 와이드 오른쪽 열 맨 위의 일정 카드 — 무엇을 세울지 고르는 규칙만 순수 함수로 검사한다
   (정적 마크업은 늘 좁은 화면이라 카드 자체는 여기서 렌더되지 않는다). */
describe('오른쪽 열의 일정 카드', () => {
  const onDay = event({ id: 'a', day: TODAY, title: '면접' });
  const next = event({ id: 'b', day: '2026-08-18' });

  it('고른 날에 일정이 있으면 그 날의 첫 일정이 선다', () => {
    expect(topEventOf([onDay], next)).toEqual({ ev: onDay, label: '이 날의 일정' });
  });

  it('고른 날이 비었으면 다가오는 일정이 대신 선다', () => {
    expect(topEventOf([], next)).toEqual({ ev: next, label: '다가오는 일정' });
  });

  // 빈 카드는 선택일 목록을 아래로 밀기만 한다
  it('둘 다 없으면 카드를 세우지 않는다', () => {
    expect(topEventOf([], null)).toBeNull();
  });
});

/* 작성 메뉴 — "+ 작성하기"가 여는 두 갈래. 어느 쪽이든 고른 날짜가 그대로 실린다. */
describe('작성 선택 메뉴', () => {
  it('고른 날짜를 머리에 달고 기록·일정 두 갈래를 준다', () => {
    const html = renderToStaticMarkup(
      <ComposeMenu day="2026-08-28" fallbackRef={{ current: null }}
        onEntry={() => {}} onEvent={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('8월 28일 (금)에 남기기');
    expect(html).toContain('기록 남기기');
    expect(html).toContain('일정 등록');
    expect(html.split('menu-row"').length - 1).toBe(2);
  });
});
