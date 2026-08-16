/* 캘린더에 실린 일정 — 셀·선택일 패널이 같은 일정을 같은 자리에 그리는지.
   특히 기간 일정은 시작일에만 찍히면 시험 기간이 하루로 읽히고, 알약 예산(3)을 기록과
   나눠 쓰지 않으면 그 날의 약속이 "+N개 더" 뒤로 숨는다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CrewEvent, Entry } from '../../shared/types';
import { COPY } from '../lib/constants';
import { CalendarView } from './CalendarView';

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

function view(opts: { entries?: Entry[]; events?: CrewEvent[]; selDay?: string }): string {
  return renderToStaticMarkup(
    <CalendarView entries={opts.entries ?? []} events={opts.events ?? []}
      selDay={opts.selDay ?? TODAY} setSelDay={() => {}} todayKey={TODAY} meId="sh"
      editingId={null} comments={new Map()} reactions={new Map()} photoUploads={new Map()}
      wit={COPY} actions={{} as never}
      onOpenEventSheet={() => {}} onDeleteEvent={() => {}} />,
  );
}

describe('캘린더의 일정', () => {
  it('기간 일정은 걸친 모든 날의 셀에 선다', () => {
    const html = view({ events: [event({ id: 'a', day: '2026-08-18', endDay: '2026-08-20' })] });
    // 알약 라벨은 셀마다 하나씩 — 사흘이면 세 번
    expect(html.split('정보처리기사 실기').length - 1).toBe(3);
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

  it('일정이 없는 달에는 범례를 그리지 않는다', () => {
    expect(view({ events: [event({ id: 'a', day: TODAY })] })).toContain('cal-legend');
    expect(view({ entries: [entry('e1', TODAY)] })).not.toContain('cal-legend');
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
