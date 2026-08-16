/* 일정 등록 시트의 태그 줄 — 하나만 고르는 자리라 "아무것도 안 고른 상태"가 없다.
   기본값과 고름·안 고름의 옷이 디자인과 어긋나면 등록 버튼까지 갔다가 태그를 다시 확인하게 된다.
   목록도 기록 시트와 따로다: 프리셋은 일정다운 3개뿐이고 커스텀은 내 일정 태그만 붙는다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MemberId } from '../../shared/types';
import { EventSheet, submittedEventDraft } from './EventSheet';

const TODAY = '2026-08-16';

function sheet(customTags: string[] = [], meId: MemberId = 'sh'): string {
  return renderToStaticMarkup(
    <EventSheet prefillDay={TODAY} meId={meId} customTags={customTags} fallbackRef={{ current: null }}
      onSubmit={() => {}} onAddCustomTag={() => null} onRemoveCustomTag={() => {}}
      onClose={() => {}} />,
  );
}

/** 태그 알약 하나의 여는 태그(<button …>태그</button>의 앞부분)만 떼어 온다 */
function chipTag(html: string, tag: string): string {
  const end = html.indexOf(`>${tag}</button>`);
  expect(end).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<button', end), end + 1);
}

/** 크루 알약의 여는 <button …>만 — 안에 든 아바타 <svg>의 속성은 떼어 낸다 */
function whoChip(html: string, name: string): string {
  const end = html.indexOf(`>${name}</button>`);
  expect(end).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', end);
  return html.slice(open, html.indexOf('>', open) + 1);
}

describe('일정 시트의 태그', () => {
  it('아무것도 안 건드리면 자격증이 골라져 있다', () => {
    const html = sheet();
    expect(chipTag(html, '자격증')).toContain('aria-pressed="true"');
    for (const t of ['면접', '시험']) {
      expect(chipTag(html, t)).toContain('aria-pressed="false"');
    }
  });

  /* 프리셋은 일정다운 3개뿐이다 — '영어'·'코딩테스트'·'기타'는 "무엇을 했나"의 말이고
     'OFF'는 쉬는 날 기록의 말이라 약속에는 뜻이 없다. */
  it('기록용 프리셋은 한 칸도 나오지 않는다', () => {
    const html = sheet();
    for (const t of ['영어', '코딩테스트', '기타', 'OFF']) {
      expect(html).not.toContain(`>${t}</button>`);
    }
  });

  it('프리셋 뒤에 내 일정 태그가 붙고 만들기 입구가 마지막이다', () => {
    const html = sheet(['발표', '면접 준비']);
    // 순서: 자격증·면접·시험 → 내 태그(코드포인트 순으로 '면접 준비' 다음 '발표') → '+ 추가'
    const at = ['자격증', '면접', '시험', '면접 준비', '발표', '"tag-chip tag-chip-add"']
      .map((s) => html.indexOf(s.startsWith('"') ? s : `>${s}</button>`));
    expect(at).not.toContain(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  /* 만들기는 칩 줄의 마지막 알약이고, 이름 칸은 누르기 전에는 없다 —
     시트가 열리자마자 빈 입력이 서 있으면 태그가 필수처럼 읽힌다. */
  it('추가 입력은 접힌 채로 시작한다', () => {
    const html = sheet();
    expect(html).toContain('class="tag-chip tag-chip-add" aria-expanded="false"');
    expect(html).not.toContain('tag-add-input');
    expect(html).not.toContain('tag-hint');
  });

  /* 기록용 커스텀 태그는 이 시트에 오지 않는다 — 넘어오는 목록 자체가 customEventTags라
     여기서는 "기본 이름과 겹치는 값이 들어와도 칩이 두 번 서지 않는다"만 지킨다. */
  it('프리셋과 같은 이름이 목록에 섞여 와도 칩은 하나뿐이다', () => {
    const html = sheet(['면접']);
    expect(html.indexOf('>면접</button>')).toBe(html.lastIndexOf('>면접</button>'));
  });

  it('동기화 목록에 OFF가 섞여 와도 일정 태그로 렌더하지 않는다', () => {
    const html = sheet(['OFF', '발표']);
    expect(html).not.toContain('>OFF</button>');
    expect(html).toContain('>발표</button>');
  });

  it('제출 값은 선택한 커스텀 태그를 CrewEvent 초안에 그대로 보존한다', () => {
    expect(submittedEventDraft(
      '  최종 면접  ',
      '면접 준비',
      ['sh'],
      '  포트폴리오  ',
      TODAY,
      null,
    )).toEqual({
      title: '최종 면접',
      tag: '면접 준비',
      participants: ['sh'],
      memo: '포트폴리오',
      day: TODAY,
      endDay: null,
    });
  });

  /* 고른 칩은 태그 색으로 채우고 테두리는 지운다(디자인 border: 1.5px solid transparent).
     채움 색만 인라인이고 투명 테두리는 .event-sheet .tag-chip[aria-pressed="true"]가 맡는다 —
     인라인에 border-color가 남으면 태그마다 다른 색 테두리가 생긴다. */
  it('고른 칩은 태그 색으로만 채우고 테두리 색을 인라인으로 쓰지 않는다', () => {
    const on = chipTag(sheet(), '자격증');
    expect(on).toContain('background:#FFF9E6');
    expect(on).toContain('color:#B37F00');
    expect(on).not.toContain('border');
  });

  it('안 고른 칩은 기본 .tag-chip 그대로 — 인라인 색이 없다', () => {
    expect(chipTag(sheet(), '면접')).not.toContain('style=');
  });

  // 커스텀 태그도 특별 취급이 없다 — 안 고른 동안은 기본 알약, 색은 tagMeta가 이름에서 뽑는다
  it('내 태그 칩도 프리셋과 같은 옷을 입는다', () => {
    expect(chipTag(sheet(['면접 준비']), '면접 준비')).not.toContain('style=');
  });
});

/* 함께하는 크루 — "A자격증 시험을 승환·웅·태현이 다 같이 친다"가 일정 하나다.
   기본이 나 혼자가 아니면 대부분의 일정에서 사람을 지우는 일부터 해야 하고, 최소 한 명이
   무너지면 아무의 캘린더에도 서지 않는 일정이 생긴다. */
describe('일정 시트의 참여 인원', () => {
  it('크루 다섯 명이 다 서고, 열 때 켜진 건 나 하나다', () => {
    const html = sheet([], 'wg');
    expect(whoChip(html, '웅')).toContain('aria-pressed="true"');
    for (const name of ['승환', '태현', '진주', '경진']) {
      expect(whoChip(html, name)).toContain('aria-pressed="false"');
    }
  });

  /* 마지막 한 명은 눌러도 안 꺼진다 — 흐리게 만들지 않고 aria로만 말한다(켜진 칩을 흐리면
     꺼진 것처럼 읽힌다). 둘 이상 켠 상태에서는 아무도 잠기지 않는다. */
  it('혼자 남은 칩은 해제 불가로 표시된다', () => {
    expect(whoChip(sheet([], 'sh'), '승환')).toContain('aria-disabled="true"');
    expect(whoChip(sheet([], 'sh'), '웅')).not.toContain('aria-disabled');
  });

  /* 켠 칩은 멤버 soft로 채우고 테두리만 제 색이다 — 태그 칩(투명 테두리)과 달리 사람은
     아바타 링과 같은 색 테두리를 가져야 칩 하나가 한 사람으로 읽힌다. */
  it('켠 칩은 멤버 색을 인라인으로 입고 안 켠 칩은 기본 알약이다', () => {
    const on = whoChip(sheet([], 'sh'), '승환');
    expect(on).toContain('background:#FFF0BF');
    expect(on).toContain('border-color:#FFB800');
    expect(whoChip(sheet([], 'sh'), '태현')).not.toContain('style=');
  });

  // 화면에 서는 차례는 누른 차례가 아니라 크루 차례다 — 대표 색(참여자[0])이 흔들리면 안 된다
  it('제출 값의 참여자는 고른 차례와 무관하게 크루 순서로 선다', () => {
    const draft = submittedEventDraft('시험', '자격증', ['th', 'sh', 'wg'], '', TODAY, null);
    expect(draft.participants).toEqual(['sh', 'wg', 'th']);
  });

  // 명부에 없는 id가 섞여 와도 일정에 실리지 않는다 — 화면에 그릴 수 없는 사람이다
  it('모르는 id는 제출 값에서 걸러진다', () => {
    const draft = submittedEventDraft('시험', '자격증', ['zz' as MemberId, 'wg'], '', TODAY, null);
    expect(draft.participants).toEqual(['wg']);
  });
});
