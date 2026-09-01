import { describe, expect, it } from 'vitest';
import type { Tag } from '../../shared/types';
import { TAGS, TAG_LIMITS } from '../../shared/types';
import {
  EMPTY_MODAL,
  PICKER_ROWS,
  PICKER_WIDTH,
  canOpenTagAdd,
  chipWidth,
  collapsedChips,
  hasTagRoom,
  photoStorageNotice,
  pickerTags,
  saveGate,
  toggledTags,
  withTag,
  type ModalState,
} from './EntryModal';

describe('toggledTags (기록 모달 다중 선택)', () => {
  it('선택 순서와 무관하게 TAGS 순서로 고정하고 여러 태그를 유지한다', () => {
    let tags: Tag[] = [];
    tags = toggledTags(tags, '기타');
    tags = toggledTags(tags, '자격증');
    tags = toggledTags(tags, '영어');
    expect(tags).toEqual(['자격증', '영어', '기타']);
  });

  it('OFF를 켜면 기존 공부 태그를 전부 지운다', () => {
    expect(toggledTags(['자격증', '영어', '기타'], 'OFF')).toEqual(['OFF']);
  });

  it('OFF가 켜진 상태에서 공부 태그를 고르면 OFF가 빠진다', () => {
    expect(toggledTags(['OFF'], '코딩테스트')).toEqual(['코딩테스트']);
  });

  it('이미 고른 태그를 다시 누르면 그 태그만 해제하고 OFF도 단독 해제할 수 있다', () => {
    expect(toggledTags(['자격증', '영어'], '자격증')).toEqual(['영어']);
    expect(toggledTags(['OFF'], 'OFF')).toEqual([]);
  });
});

describe('withTag (방금 만든 태그 켜기)', () => {
  it('이미 켜진 태그를 다시 켜도 꺼지지 않는다 — 토글과 다른 지점', () => {
    // 목록에서 지웠다 다시 추가하는 경우: 그 이름은 이미 이 기록에 붙어 있을 수 있다
    expect(withTag(['헬스'], '헬스')).toEqual(['헬스']);
    expect(toggledTags(['헬스'], '헬스')).toEqual([]);
  });

  it('OFF 배타 규칙은 토글과 같다', () => {
    expect(withTag(['OFF'], '헬스')).toEqual(['헬스']);
    expect(withTag(['영어', '헬스'], 'OFF')).toEqual(['OFF']);
  });

  it('공백·미정규화 이름을 받아도 정규화된 값으로 켠다', () => {
    expect(withTag(['영어'], '  주말  독서 ')).toEqual(['영어', '주말 독서']);
  });
});

describe('hasTagRoom (기록당 태그 수 한도)', () => {
  // 기본 4개 + 커스텀 4개 = 8개, 이미 꽉 찬 기록
  const full: Tag[] = ['자격증', '영어', '코딩테스트', '기타', 'aa', 'bb', 'cc', 'dd'];

  it('꽉 찬 기록에는 이름이 무엇이든 새 태그를 넣을 자리가 없다', () => {
    expect(full.length).toBe(TAG_LIMITS.perEntry);
    expect(hasTagRoom(full, '하하')).toBe(false); // 코드포인트가 큰 이름
    expect(hasTagRoom(full, 'AA')).toBe(false); // 코드포인트가 작은 이름
  });

  it('절단에 기대면 아홉 번째 태그의 운명이 이름 순서로 갈린다 — 그래서 막는다', () => {
    // 큰 이름은 잘려 나가 눌러도 켜지지 않고…
    expect(withTag(full, '하하')).not.toContain('하하');
    // …작은 이름은 이미 고른 태그 하나를 조용히 밀어내고 켜진다
    expect(withTag(full, 'AA')).toContain('AA');
    expect(withTag(full, 'AA')).not.toContain('dd');
  });

  it('이미 켜진 태그와 OFF는 새 자리를 먹지 않는다', () => {
    expect(hasTagRoom(full, '자격증')).toBe(true); // 끄기 — 토글은 언제나 된다
    expect(hasTagRoom(full, 'dd')).toBe(true);
    expect(hasTagRoom(full, 'OFF')).toBe(true); // 쉬는 날은 나머지를 비우고 혼자 남는다
  });

  it('자리가 하나 남으면 새 태그가 들어간다', () => {
    const seven = full.slice(0, 7);
    expect(hasTagRoom(seven, '하하')).toBe(true);
    expect(withTag(seven, '하하')).toContain('하하');
  });

  it('정화되지 않는 이름은 한도가 아니라 검증이 막을 몫이라 통과시킨다', () => {
    // 한도 문구("8개까지예요")가 진짜 실패 사유(길이·빈 이름)를 가리면 안 된다
    expect(hasTagRoom(full, '   ')).toBe(true);
    expect(hasTagRoom(full, '가'.repeat(TAG_LIMITS.nameLen + 1))).toBe(true);
  });
});

describe('pickerTags (피커에 늘어놓을 태그)', () => {
  it('기본 5개 뒤에 내 커스텀 태그가 코드포인트 순서로 붙고, 지울 수 있는 건 그것뿐이다', () => {
    const { all, removable } = pickerTags(['헬스', 'gym', '독서'], []);
    expect(all).toEqual([...TAGS, 'gym', '독서', '헬스']);
    expect([...removable]).toEqual(['gym', '독서', '헬스']);
  });

  it('목록에서 지웠지만 이 기록에 아직 붙어 있는 태그도 칩으로 남는다 (지울 수는 없다)', () => {
    const { all, removable } = pickerTags(['독서'], ['영어', '헬스']);
    expect(all).toEqual([...TAGS, '독서', '헬스']);
    expect(removable.has('헬스')).toBe(false);
  });

  it('유령 태그(목록엔 없고 이 기록엔 붙어 있는 이름)만 ghosts로 따로 나온다', () => {
    const { ghosts } = pickerTags(['독서'], ['영어', '헬스', '독서']);
    // 기본 태그(영어)와 내 목록에 있는 이름(독서)은 재등록할 것이 없으므로 유령이 아니다
    expect(ghosts).toEqual(['헬스']);
    expect(pickerTags(['헬스'], ['헬스']).ghosts).toEqual([]);
  });

  it('고른 태그가 이미 내 목록에 있으면 두 번 나오지 않는다', () => {
    const { all } = pickerTags(['독서'], ['독서']);
    expect(all.filter((t) => t === '독서')).toEqual(['독서']);
  });

  it('기본 태그가 커스텀 목록에 섞여 와도 칩이 겹치지 않는다', () => {
    const { all, removable } = pickerTags(['영어', '독서'], []);
    expect(all).toEqual([...TAGS, '독서']);
    expect(removable.has('영어')).toBe(false);
  });
});

describe('canOpenTagAdd (+ 추가 입력 열기)', () => {
  // 기본 4개 + 커스텀 4개 = 8개, 이미 꽉 찬 수정 기록
  const full: Tag[] = ['자격증', '영어', '코딩테스트', '기타', 'aa', 'bb', 'cc', 'dd'];

  it('자리가 남으면 목록이 어떻든 열린다', () => {
    expect(canOpenTagAdd(full.slice(0, 7), ['aa', 'bb', 'cc'])).toBe(true);
    expect(canOpenTagAdd([], [])).toBe(true);
  });

  it('꽉 찼고 고른 태그가 전부 내 목록에 있으면 새로 적을 이름이 없다 — 닫는다', () => {
    expect(canOpenTagAdd(full, ['aa', 'bb', 'cc', 'dd'])).toBe(false);
    // 기본 태그는 목록에 없어도 유령이 아니다 — 재등록해도 onAddCustomTag가 거절한다
    expect(canOpenTagAdd(full, ['aa', 'bb', 'cc', 'dd', '영어'])).toBe(false);
  });

  it('꽉 차도 유령 태그가 남아 있으면 열린다 — 재등록은 선택 수를 늘리지 않는다', () => {
    // 'dd'를 목록에서 지웠지만 이 기록에는 아직 붙어 있다: 다시 등록하는 길이 막히면
    // 태그 여덟 개를 고른 기록에서는 그 이름을 영영 되살릴 수 없다
    expect(canOpenTagAdd(full, ['aa', 'bb', 'cc'])).toBe(true);
    // 열기와 확정이 같은 뜻이라 재등록은 끝까지 간다 — 자리를 새로 먹지 않으므로
    expect(hasTagRoom(full, 'dd')).toBe(true);
    expect(withTag(full, 'dd')).toEqual(full);
  });

  it('꽉 찬 상태에서 새 이름을 확정하는 길은 그대로 막혀 있다', () => {
    expect(canOpenTagAdd(full, ['aa', 'bb', 'cc'])).toBe(true); // 유령 때문에 열리지만…
    expect(hasTagRoom(full, '새태그')).toBe(false); // …새 이름은 확정에서 걸린다
  });
});

describe('chipWidth (접힘 판정용 어림 폭)', () => {
  it('한글은 글자 크기만큼, 라틴·숫자는 그보다 좁게 센다', () => {
    expect(chipWidth('가가')).toBeGreaterThan(chipWidth('ab'));
    expect(chipWidth('가가가')).toBeGreaterThan(chipWidth('가가'));
  });

  it('가장 긴 이름(12자)도 한 줄 안에 들어간다 — 칩 하나가 폭을 넘기면 접어도 소용없다', () => {
    expect(chipWidth('가'.repeat(TAG_LIMITS.nameLen))).toBeLessThan(PICKER_WIDTH);
  });
});

describe('collapsedChips (피커 오버플로)', () => {
  const short = ['c1', 'c2', 'c3', 'c4', 'c5'];
  const long = ['가'.repeat(12), '나'.repeat(12), '다'.repeat(12)];

  it('두 줄 안에 들어가면 접지 않는다', () => {
    const few = [...TAGS, 'c1', 'c2'];
    const r = collapsedChips(few, [], false);
    expect(r.collapsible).toBe(false);
    expect(r.shown).toEqual(few);
    expect(r.hidden).toBe(0);
  });

  it('넘치면 앞에서부터 자르고 나머지 수를 알린다', () => {
    const all = [...TAGS, ...short];
    const r = collapsedChips(all, [], false);
    expect(r.collapsible).toBe(true);
    expect(r.shown).toEqual([...TAGS, 'c1', 'c2', 'c3']);
    expect(r.hidden).toBe(2);
  });

  it('줄 수를 정하는 건 개수가 아니라 이름 길이다 — 12자 태그 둘이면 여덟 칸도 안 돼 접힌다', () => {
    // 개수 기준(칩 9개 초과)이었을 때는 +n이 아예 뜨지 않아 네 줄까지 늘어졌다
    const two = [...TAGS, long[0]!, long[1]!];
    expect(two.length).toBeLessThan(9);
    const r = collapsedChips(two, [], false);
    expect(r.collapsible).toBe(true);
    expect(r.shown).toEqual([...TAGS]);
    expect(r.hidden).toBe(2);
  });

  it('짧은 이름이면 같은 개수라도 접지 않는다 — 길이가 기준이라는 뜻', () => {
    expect(collapsedChips([...TAGS, 'c1', 'c2'], [], false).collapsible).toBe(false);
    expect(collapsedChips([...TAGS, long[0]!, long[1]!], [], false).collapsible).toBe(true);
  });

  it('보여 주는 칩은 +n·+ 추가 칩까지 합쳐 두 줄 안에 들어간다', () => {
    for (const all of [[...TAGS, ...short], [...TAGS, ...long]]) {
      const { shown } = collapsedChips(all, [], false);
      // 실제 칩 줄바꿈과 같은 탐욕 규칙으로 다시 세어 본다(gap 6px)
      let rows = 1;
      let cur = 0;
      for (const w of [...shown.map(chipWidth), chipWidth('+12'), chipWidth('추가') + 16]) {
        if (cur === 0) cur = w;
        else if (cur + 6 + w > PICKER_WIDTH) { rows += 1; cur = w; }
        else cur += 6 + w;
      }
      expect(rows).toBeLessThanOrEqual(PICKER_ROWS);
    }
  });

  it('접혀도 고른 태그는 반드시 보인다 — 안 보이는 선택은 없는 선택으로 읽힌다', () => {
    const all = [...TAGS, ...short];
    const r = collapsedChips(all, ['c5'], false);
    expect(r.shown).toContain('c5');
    expect(r.shown).toEqual([...TAGS, 'c1', 'c2', 'c5']);
    expect(r.hidden).toBe(2);
  });

  it('맨 뒤의 긴 태그가 켜져 있으면 그 자리를 내주고 앞쪽을 접는다', () => {
    const all = [...TAGS, ...long];
    const r = collapsedChips(all, [long[2]!], false);
    expect(r.shown).toContain(long[2]);
    expect(r.shown).toEqual(['자격증', '영어', '코딩테스트', '기타', long[2]]);
    expect(r.hidden).toBe(3);
  });

  it('좁은 컨테이너에서는 같은 조합도 접힌다 — 360px 화면(시트 안쪽 320px)', () => {
    // 390px 기준 상수(350)로는 두 줄이라 "+n"이 뜨지 않던 조합. 실제 360px 화면에서는
    // OFF·5자 태그 둘·+ 추가가 둘째 줄에 다 못 들어가 세 줄이 된다.
    const all = [...TAGS, '주말독서회', '아침운동반'];
    expect(collapsedChips(all, [], false).collapsible).toBe(false);
    const narrow = collapsedChips(all, [], false, 320);
    expect(narrow.collapsible).toBe(true);
    expect(narrow.shown).toEqual([...TAGS, '주말독서회']);
    expect(narrow.hidden).toBe(1);
  });

  it('넓은 컨테이너에서는 덜 접힌다 — 데스크톱 시트 안쪽 408px', () => {
    const all = [...TAGS, ...short];
    expect(collapsedChips(all, [], false).collapsible).toBe(true); // 모바일에서는 +2
    expect(collapsedChips(all, [], false, 408).collapsible).toBe(false);
    expect(collapsedChips(all, [], false, 408).shown).toEqual(all);
  });

  it('폭을 넘기지 않으면 390px 화면 기준값으로 판정한다', () => {
    const all = [...TAGS, ...short];
    expect(collapsedChips(all, [], false)).toEqual(collapsedChips(all, [], false, PICKER_WIDTH));
  });

  it('펼치면 전부 보이고 접을 수 있다는 사실은 그대로다', () => {
    const all = [...TAGS, ...short];
    const r = collapsedChips(all, [], true);
    expect(r.shown).toEqual(all);
    expect(r.hidden).toBe(0);
    expect(r.collapsible).toBe(true);
  });
});

describe('saveGate (한 장짜리 시트의 저장 문턱)', () => {
  const m = (p: Partial<ModalState>): ModalState => ({ ...EMPTY_MODAL, open: true, day: '2026-08-14', ...p });

  it('태그·별점·내용이 다 있어야 새 기록을 저장할 수 있다', () => {
    expect(saveGate(m({ tags: ['영어'], stars: 4, body: '단어 30개' })).canSave).toBe(true);
  });

  it('막힌 이유는 태그 → 별점 → 내용 순으로 하나씩만 알린다', () => {
    expect(saveGate(m({})).blocked).toBe('무엇을 했는지 골라주세요');
    expect(saveGate(m({ tags: ['영어'] })).blocked).toBe('만족도를 골라주세요');
    expect(saveGate(m({ tags: ['영어'], stars: 3 })).blocked)
      .toBe('기록을 적거나 사진 또는 공부 시간을 입력해 주세요');
    expect(saveGate(m({ tags: ['영어'], stars: 3, body: '한 줄' })).blocked).toBe('');
  });

  it('쉬는 날은 별점을 묻지 않는다 — 내용만 있으면 저장된다', () => {
    expect(saveGate(m({ tags: ['OFF'] })).blocked)
      .toBe('기록을 적거나 사진 또는 공부 시간을 입력해 주세요');
    expect(saveGate(m({ tags: ['OFF'], body: '재충전' })).canSave).toBe(true);
  });

  it('공부시간만 적어도 새 기록의 내용으로 친다', () => {
    const gate = saveGate(m({
      tags: ['영어'], stars: 4, studyHoursInput: '1', studyMinutesInput: '30',
    }));
    expect(gate.canSave).toBe(true);
    expect(gate.hasContent).toBe(true);
    expect(gate.studyMinutes).toBe(90);
  });

  it('잘못 적은 공부시간은 저장을 막고 구체적인 이유를 말한다', () => {
    const badMinute = saveGate(m({
      tags: ['영어'], stars: 4, studyHoursInput: '1', studyMinutesInput: '60', body: '본문',
    }));
    expect(badMinute.canSave).toBe(false);
    expect(badMinute.blocked).toBe('분은 0~59로 입력해 주세요');

    const tooLong = saveGate(m({
      tags: ['영어'], stars: 4, studyHoursInput: '24', studyMinutesInput: '1', body: '본문',
    }));
    expect(tooLong.blocked).toBe('하루 공부 시간은 24시간 이내로 입력해 주세요');
  });

  it('OFF는 폼에 남은 공부시간을 저장 문턱과 저장값에서 무시한다', () => {
    const gate = saveGate(m({ tags: ['OFF'], studyHoursInput: '2', body: '재충전' }));
    expect(gate.canSave).toBe(true);
    expect(gate.studyMinutes).toBeNull();
  });

  it('수정은 내용을 다 지워도 저장할 수 있다 — 지우는 것도 수정이다', () => {
    expect(saveGate(m({ editingId: 'e1', tags: ['영어'], stars: 3 })).canSave).toBe(true);
    // 태그·별점 문턱은 수정에도 그대로 남는다
    expect(saveGate(m({ editingId: 'e1', tags: ['영어'] })).canSave).toBe(false);
  });

  it('할 일만 적어도 내용으로 친다 (공백뿐인 줄은 빼고)', () => {
    expect(saveGate(m({ tags: ['기타'], stars: 2, todos: [{ t: '  ', done: false }] })).hasContent).toBe(false);
    expect(saveGate(m({ tags: ['기타'], stars: 2, todos: [{ t: '기출 1회', done: false }] })).canSave).toBe(true);
  });

  it('본문이 없어도 사진이 있으면 새 기록을 저장할 수 있다', () => {
    expect(saveGate(m({
      tags: ['영어'],
      stars: 3,
      photos: [{ id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 }],
    })).canSave).toBe(true);
  });

  it('사진을 준비하는 중이면 아직 비어 있어도 막지 않는다 — 저장은 준비가 끝난 뒤 이어진다', () => {
    const sheet = m({ tags: ['영어'], stars: 3 });
    expect(saveGate(sheet).blocked).toBe('기록을 적거나 사진 또는 공부 시간을 입력해 주세요');
    const gate = saveGate(sheet, true);
    expect(gate.canSave).toBe(true);
    expect(gate.blocked).toBe('');
    // 준비 중은 아직 "내용"이 아니다 — 초안 표시는 여전히 비어 있는 시트로 본다
    expect(gate.hasContent).toBe(false);
  });

  it('준비 중이라도 태그·별점 문턱은 그대로다', () => {
    expect(saveGate(m({}), true).blocked).toBe('무엇을 했는지 골라주세요');
    expect(saveGate(m({ tags: ['영어'] }), true).blocked).toBe('만족도를 골라주세요');
  });
});

describe('photoStorageNotice (사진 내구성 안내)', () => {
  it('IDB unavailable/quota-error + offline은 추가를 막고 안전 보관 불가를 알린다', () => {
    for (const durableStorage of ['unavailable', 'quota-error'] as const) {
      const notice = photoStorageNotice({
        durableStorage,
        online: false,
        demo: false,
        full: false,
        hasPhotos: false,
      });
      expect(notice.blocksAdd).toBe(true);
      expect(notice.text).toContain('오프라인에서는 추가할 수 없어요');
      expect(notice.tone).toBe('warn');
    }
  });

  it('IDB unavailable + online은 추가를 허용하되 페이지 유지 경고를 계속 보인다', () => {
    const notice = photoStorageNotice({
      durableStorage: 'unavailable',
      online: true,
      demo: false,
      full: false,
      hasPhotos: true,
    });
    expect(notice.blocksAdd).toBe(false);
    expect(notice.text).toContain('업로드가 끝날 때까지 페이지를 닫지 마세요');
    expect(notice.tone).toBe('warn');
  });
});
