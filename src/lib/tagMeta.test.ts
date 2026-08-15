/* 커스텀 태그의 표시 폴백 — 피드·보드·달력은 남이 만든 태그를 이름만 보고 그린다.
   여기서 지키는 것은 두 가지다: 색이 기기·엔진에 따라 흔들리지 않을 것(같은 태그가
   사람마다 다른 색이면 같은 태그를 다른 태그로 읽는다), 그리고 어떤 색을 뽑든 글자가
   읽힐 것(팔레트를 손볼 때 대비를 잃기 쉽다). */
import { describe, expect, it } from 'vitest';
import { TAGS } from '../../shared/types';
import { TAGMETA, tagMeta } from './constants';

/** WCAG 상대 휘도 대비비 — 본문 크기 글자의 기준선은 4.5:1이다. */
function contrast(bg: string, fg: string): number {
  const lum = (hex: string): number => {
    const ch = (i: number): number => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  };
  const [a, b] = [lum(bg), lum(fg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('tagMeta (커스텀 태그 표시 폴백)', () => {
  it('기본 태그는 제 색 그대로 돌려준다', () => {
    for (const t of TAGS) expect(tagMeta(t)).toEqual(TAGMETA[t]);
  });

  it('같은 이름은 늘 같은 색 — 해시가 환경에 기대면 크루가 서로 다른 색을 본다', () => {
    // 값을 못 박아 둔다. 해시나 팔레트 순서가 바뀌면 이 줄이 먼저 깨져야 한다.
    expect(tagMeta('헬스')).toEqual(tagMeta('헬스'));
    expect(tagMeta('헬스').bg).toBe('#F4EBE3');
    expect(tagMeta('독서').bg).toBe('#FBE9F6');
    expect(tagMeta('gym').bg).toBe('#F1E9FE');
  });

  it('기본 태그가 아니면 기본 아이콘이 아니라 범용 태그 아이콘을 쓴다', () => {
    const custom = tagMeta('헬스');
    for (const t of TAGS) expect(custom.icon).not.toBe(TAGMETA[t].icon);
  });

  it('어떤 이름이 와도 팔레트 안의 색이고, 글자가 배경 위에서 읽힌다', () => {
    const names = ['헬스', '독서', 'gym', '주말 정리', '자기소개서', '面接', '🏃 러닝', 'ㄱ', 'z'];
    for (const n of names) {
      const tm = tagMeta(n);
      expect(tm.bg).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrast(tm.bg, tm.fg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('빈 문자열처럼 정규화를 못 지난 값이 새어 들어와도 터지지 않는다', () => {
    expect(tagMeta('').bg).toMatch(/^#[0-9A-F]{6}$/);
  });
});
