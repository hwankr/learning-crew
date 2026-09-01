import { describe, expect, it } from 'vitest';
import {
  formatStudyMinutes,
  normalizeStudyTimeInputPart,
  parseStudyTimeInput,
  splitStudyMinutes,
} from './studyTime';

describe('parseStudyTimeInput (시간/분 직접 입력)', () => {
  it('빈 두 칸은 미입력(null), 한 칸만 채우면 다른 칸은 0으로 본다', () => {
    expect(parseStudyTimeInput('', '')).toEqual({ minutes: null, error: '' });
    expect(parseStudyTimeInput('', '45')).toEqual({ minutes: 45, error: '' });
    expect(parseStudyTimeInput('2', '')).toEqual({ minutes: 120, error: '' });
  });

  it('1분부터 24시간까지 허용한다', () => {
    expect(parseStudyTimeInput('', '1').minutes).toBe(1);
    expect(parseStudyTimeInput('23', '59').minutes).toBe(1439);
    expect(parseStudyTimeInput('24', '0').minutes).toBe(1440);
  });

  it('0분·60분짜리 분 칸·24시간 초과를 구분해 막는다', () => {
    expect(parseStudyTimeInput('0', '0').error).toContain('1분 이상');
    expect(parseStudyTimeInput('1', '60').error).toContain('0~59');
    expect(parseStudyTimeInput('24', '1').error).toContain('24시간 이내');
  });
});

describe('공부시간 입력 복원과 표시', () => {
  it('총 분을 수정 시트의 시간/분으로 분해한다', () => {
    expect(splitStudyMinutes(45)).toEqual({ hours: '', minutes: '45' });
    expect(splitStudyMinutes(120)).toEqual({ hours: '2', minutes: '0' });
    expect(splitStudyMinutes(null)).toEqual({ hours: '', minutes: '' });
  });

  it('초안 입력은 두 자리 숫자 문자열만 되살린다', () => {
    expect(normalizeStudyTimeInputPart('05')).toBe('05');
    expect(normalizeStudyTimeInputPart('123')).toBe('');
    expect(normalizeStudyTimeInputPart('한')).toBe('');
  });

  it('카드·통계가 공유할 문구로 포맷한다', () => {
    expect(formatStudyMinutes(0)).toBe('0분');
    expect(formatStudyMinutes(45)).toBe('45분');
    expect(formatStudyMinutes(120)).toBe('2시간');
    expect(formatStudyMinutes(125)).toBe('2시간 5분');
  });
});
