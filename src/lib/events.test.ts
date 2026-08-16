/* 일정 표시 규칙 — 셀·패널·배너가 같은 일정을 같은 말로 부르는지. 특히 기간 일정은
   "시작은 지났지만 아직 진행 중"이라는 상태가 있어서, 지남 판정이 종료일을 봐야 한다. */
import { describe, expect, it } from 'vitest';
import type { CrewEvent } from '../../shared/types';
import type { MemberId } from '../../shared/types';
import { UNKNOWN_MEMBER_NAME } from './constants';
import {
  dLabel, dayDiff, dayLabel, eventDdayLabel, eventDays, eventMembers, eventParticipants,
  eventPhase, eventSpanLabel, eventWhenLabel, eventsByDay, eventsDayMembers, isOngoing,
  participantsLabel, shiftDay, upcomingEvent,
} from './events';

const TODAY = '2026-08-16';

function ev(p: Partial<CrewEvent> & Pick<CrewEvent, 'id' | 'day'>): CrewEvent {
  return {
    m: 'sh', participants: ['sh'], title: '일정', tag: '기타', memo: '', endDay: null,
    v: 0, updatedAt: '2026-08-16T00:00:00.000Z', deletedAt: null, ...p,
  };
}

describe('dayDiff · shiftDay', () => {
  it('달·해 경계를 넘어 센다', () => {
    expect(dayDiff('2026-08-30', '2026-09-02')).toBe(3);
    expect(dayDiff('2026-01-01', '2025-12-31')).toBe(-1);
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29'); // 윤년
  });
});

describe('dLabel', () => {
  it('오늘·미래·과거를 D-DAY / D-N / D+N으로 부른다', () => {
    expect(dLabel(TODAY, TODAY)).toBe('D-DAY');
    expect(dLabel('2026-08-19', TODAY)).toBe('D-3');
    expect(dLabel('2026-08-14', TODAY)).toBe('D+2');
  });
});

describe('eventPhase', () => {
  it('시작이 7일 안으로 들어오면 임박이다', () => {
    expect(eventPhase(ev({ id: 'a', day: TODAY }), TODAY)).toBe('near');
    expect(eventPhase(ev({ id: 'a', day: '2026-08-23' }), TODAY)).toBe('near');
    expect(eventPhase(ev({ id: 'a', day: '2026-08-24' }), TODAY)).toBe('ahead');
  });

  // 시작일만 보면 진행 중인 시험 기간이 첫날 다음부터 '지남'이 된다
  it('기간 일정은 종료일이 지나야 지난 일정이다', () => {
    expect(eventPhase(ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-15' }), TODAY)).toBe('past');
    expect(eventPhase(ev({ id: 'a', day: '2026-08-15' }), TODAY)).toBe('past');
  });

  // 지금 겪고 있는 일이 다음 주 시험보다 덜 급할 수는 없다 — 진행 중은 임박과 같은 옷이다
  it('진행 중인 기간 일정은 임박으로 본다', () => {
    expect(eventPhase(ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-20' }), TODAY)).toBe('near');
    expect(eventPhase(ev({ id: 'a', day: '2026-07-01', endDay: '2026-12-31' }), TODAY)).toBe('near');
    expect(eventPhase(ev({ id: 'a', day: TODAY, endDay: '2026-08-20' }), TODAY)).toBe('near');
  });

  it('지난 일정의 접두는 며칠 지났는지가 아니라 "지남"이다', () => {
    expect(eventDdayLabel(ev({ id: 'a', day: '2026-08-10' }), TODAY)).toBe('지남');
    expect(eventDdayLabel(ev({ id: 'a', day: '2026-08-19' }), TODAY)).toBe('D-3');
  });
});

/* 시작일 기준 D+n은 진행 중인 기간 일정에서 "지난 일"처럼 읽힌다 — 시험 6일째가 'D+6'.
   기간 안에 있는 동안은 남은 날을 세는 대신 지금 겪고 있다고 말한다. */
describe('isOngoing · 진행 중 라벨', () => {
  it('오늘이 기간 안(시작일·종료일 포함)이면 진행 중이다', () => {
    expect(isOngoing(ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-20' }), TODAY)).toBe(true);
    expect(isOngoing(ev({ id: 'a', day: TODAY, endDay: '2026-08-20' }), TODAY)).toBe(true);
    expect(isOngoing(ev({ id: 'a', day: '2026-08-10', endDay: TODAY }), TODAY)).toBe(true);
  });

  it('기간 밖·하루 일정은 진행 중이 아니다', () => {
    expect(isOngoing(ev({ id: 'a', day: '2026-08-01', endDay: '2026-08-15' }), TODAY)).toBe(false);
    expect(isOngoing(ev({ id: 'a', day: '2026-08-17', endDay: '2026-08-20' }), TODAY)).toBe(false);
    // 오늘 하루짜리는 진행 중이 아니라 D-DAY다 — 종료일이 없으면 셀 기간이 없다
    expect(isOngoing(ev({ id: 'a', day: TODAY }), TODAY)).toBe(false);
    // 정규화를 거치지 않은 뒤집힌 기간도 하루 일정으로 본다(eventDays와 같은 기준)
    expect(isOngoing(ev({ id: 'a', day: TODAY, endDay: '2026-08-10' }), TODAY)).toBe(false);
  });

  it('진행 중이면 D+n 대신 "진행 중", 밖이면 기존 라벨 그대로', () => {
    expect(eventDdayLabel(ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-20' }), TODAY)).toBe('진행 중');
    expect(eventDdayLabel(ev({ id: 'a', day: TODAY, endDay: '2026-08-20' }), TODAY)).toBe('진행 중');
    // 끝난 기간 일정은 진행 중을 지나 '지남'으로 간다
    expect(eventDdayLabel(ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-15' }), TODAY)).toBe('지남');
    // 아직 시작 안 한 기간 일정은 시작까지 며칠인지가 여전히 궁금한 값이다
    expect(eventDdayLabel(ev({ id: 'a', day: '2026-08-19', endDay: '2026-08-21' }), TODAY)).toBe('D-3');
    expect(eventDdayLabel(ev({ id: 'a', day: TODAY }), TODAY)).toBe('D-DAY');
  });
});

describe('eventDays · eventsByDay', () => {
  it('기간 일정은 시작·종료를 포함한 모든 날에 걸린다', () => {
    expect(eventDays(ev({ id: 'a', day: '2026-08-30', endDay: '2026-09-01' })))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    expect(eventDays(ev({ id: 'a', day: '2026-08-30' }))).toEqual(['2026-08-30']);
  });

  // 정규화를 거치지 않은 값(종료일이 시작일보다 앞)도 하루 일정으로 읽어야 한다
  it('종료일이 시작일보다 앞이면 하루 일정으로 본다', () => {
    expect(eventDays(ev({ id: 'a', day: '2026-08-20', endDay: '2026-08-18' })))
      .toEqual(['2026-08-20']);
  });

  it('같은 날의 일정은 시작일 이른 순으로 줄을 선다', () => {
    const long = ev({ id: 'b', day: '2026-08-14', endDay: '2026-08-18', title: '시험 기간' });
    const short = ev({ id: 'a', day: '2026-08-18', title: '면접' });
    const byDay = eventsByDay([short, long]);
    expect(byDay.get('2026-08-18')?.map((e) => e.title)).toEqual(['시험 기간', '면접']);
    expect(byDay.get('2026-08-14')?.map((e) => e.title)).toEqual(['시험 기간']);
  });
});

describe('upcomingEvent', () => {
  it('아직 안 끝난 것 중 가장 이른 일정을 고른다', () => {
    const list = [
      ev({ id: 'a', day: '2026-08-25', title: '나중' }),
      ev({ id: 'b', day: '2026-08-10', title: '지남' }),
      ev({ id: 'c', day: '2026-08-19', title: '다음' }),
    ];
    expect(upcomingEvent(list, TODAY)?.title).toBe('다음');
  });

  // 진행 중인 기간 일정은 시작일이 지났어도 "다가오는" 자리를 차지한다 — 지금 겪는 일이다
  it('진행 중인 기간 일정을 지나간 것으로 버리지 않는다', () => {
    const list = [ev({ id: 'a', day: '2026-08-10', endDay: '2026-08-20', title: '시험 기간' })];
    expect(upcomingEvent(list, TODAY)?.title).toBe('시험 기간');
  });

  it('남은 일정이 없으면 null', () => {
    expect(upcomingEvent([ev({ id: 'a', day: '2026-08-10' })], TODAY)).toBeNull();
  });
});

/* 참여 인원 — 일정 하나에 사람이 여럿이다("A자격증 시험을 승환·웅·태현이 다 같이 친다").
   셀 점·패널 행·홈 배너가 같은 일정에서 같은 사람들을 같은 차례로 세는지가 여기 달렸다. */
describe('eventParticipants · eventMembers', () => {
  it('참여자가 비면 등록자 하나로 되살린다', () => {
    expect(eventParticipants(ev({ id: 'a', day: TODAY, m: 'wg', participants: [] }))).toEqual(['wg']);
    // 정규화를 지나지 않은 구버전 시드 — 필드 자체가 없어도 같은 폴백이다
    const legacy = { m: 'th' } as unknown as { m: MemberId; participants: MemberId[] };
    expect(eventParticipants(legacy)).toEqual(['th']);
  });

  it('참여자가 있으면 등록자와 무관하게 그들이 당사자다', () => {
    const e = ev({ id: 'a', day: TODAY, m: 'sh', participants: ['wg', 'th'] });
    expect(eventParticipants(e)).toEqual(['wg', 'th']);
    expect(eventMembers(e).map((m) => m.name)).toEqual(['웅', '태현']);
  });

  // 차례는 늘 크루 순서다 — 저장된 배열이 뒤섞여 있어도 화면의 아바타 차례는 흔들리지 않는다
  it('멤버 차례는 크루 순서로 세우고 모르는 id는 중립 표시로 뒤에 남긴다', () => {
    const e = ev({ id: 'a', day: TODAY, participants: ['th', 'zz' as MemberId, 'sh'] });
    expect(eventMembers(e).map((m) => m.name)).toEqual(['승환', '태현', UNKNOWN_MEMBER_NAME]);
  });

  // 셀의 네모 점 하나는 일정 하나가 아니라 사람 하나다 — 두 일정에 함께 든 사람도 점은 하나
  it('그 날 일정들의 참여자를 사람 기준으로 한 번씩만 센다', () => {
    const list = [
      ev({ id: 'a', day: TODAY, participants: ['sh', 'th'] }),
      ev({ id: 'b', day: TODAY, participants: ['th', 'wg'] }),
    ];
    expect(eventsDayMembers(list).map((m) => m.name)).toEqual(['승환', '웅', '태현']);
    expect(eventsDayMembers([])).toEqual([]);
  });
});

describe('participantsLabel', () => {
  it('둘까지는 이름을 잇고 셋부터는 접는다', () => {
    expect(participantsLabel([{ name: '승환' }])).toBe('승환');
    expect(participantsLabel([{ name: '승환' }, { name: '웅' }])).toBe('승환·웅');
    expect(participantsLabel([{ name: '승환' }, { name: '웅' }, { name: '태현' }])).toBe('승환 외 2');
  });
});

describe('날짜 문구', () => {
  it('하루 일정은 요일까지, 기간은 짧게 잇는다', () => {
    expect(dayLabel('2026-08-18')).toBe('8월 18일 (화)');
    expect(eventSpanLabel('2026-08-18', null)).toBe('8월 18일');
    expect(eventSpanLabel('2026-08-18', '2026-08-20')).toBe('8월 18–20일');
    expect(eventSpanLabel('2026-08-30', '2026-09-02')).toBe('8월 30일–9월 2일');
    expect(eventWhenLabel('2026-08-18', null)).toBe('8월 18일 (화)');
    expect(eventWhenLabel('2026-08-18', '2026-08-20')).toBe('8월 18–20일');
  });
});
