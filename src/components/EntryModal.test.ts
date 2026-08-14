import { describe, expect, it } from 'vitest';
import type { Tag } from '../../shared/types';
import { EMPTY_MODAL, saveGate, toggledTags, type ModalState } from './EntryModal';

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

describe('saveGate (한 장짜리 시트의 저장 문턱)', () => {
  const m = (p: Partial<ModalState>): ModalState => ({ ...EMPTY_MODAL, open: true, day: '2026-08-14', ...p });

  it('태그·별점·내용이 다 있어야 새 기록을 저장할 수 있다', () => {
    expect(saveGate(m({ tags: ['영어'], stars: 4, body: '단어 30개' })).canSave).toBe(true);
  });

  it('막힌 이유는 태그 → 별점 → 내용 순으로 하나씩만 알린다', () => {
    expect(saveGate(m({})).blocked).toBe('무엇을 했는지 골라주세요');
    expect(saveGate(m({ tags: ['영어'] })).blocked).toBe('만족도를 골라주세요');
    expect(saveGate(m({ tags: ['영어'], stars: 3 })).blocked).toBe('기록을 한 줄 적거나 사진을 넣어주세요');
    expect(saveGate(m({ tags: ['영어'], stars: 3, body: '한 줄' })).blocked).toBe('');
  });

  it('쉬는 날은 별점을 묻지 않는다 — 내용만 있으면 저장된다', () => {
    expect(saveGate(m({ tags: ['OFF'] })).blocked).toBe('기록을 한 줄 적거나 사진을 넣어주세요');
    expect(saveGate(m({ tags: ['OFF'], body: '재충전' })).canSave).toBe(true);
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
});
