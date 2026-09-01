import { STUDY_MINUTES_MAX } from '../../shared/types';

const DIGITS_RE = /^\d+$/;

export interface StudyTimeValue {
  minutes: number | null;
  error: string;
}

/** 작성 시트의 두 칸(시간/분)을 저장용 총 분으로 바꾼다.
    빈 두 칸은 선택 입력을 하지 않은 뜻이고, 한 칸만 채우면 다른 칸은 0으로 본다. */
export function parseStudyTimeInput(hoursRaw: string, minutesRaw: string): StudyTimeValue {
  const hoursText = hoursRaw.trim();
  const minutesText = minutesRaw.trim();
  if (!hoursText && !minutesText) return { minutes: null, error: '' };
  if ((hoursText && !DIGITS_RE.test(hoursText)) || (minutesText && !DIGITS_RE.test(minutesText))) {
    return { minutes: null, error: '공부 시간은 숫자로 입력해 주세요' };
  }

  const hours = hoursText ? Number(hoursText) : 0;
  const minutePart = minutesText ? Number(minutesText) : 0;
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutePart)) {
    return { minutes: null, error: '공부 시간을 다시 입력해 주세요' };
  }
  if (minutePart > 59) return { minutes: null, error: '분은 0~59로 입력해 주세요' };

  const total = hours * 60 + minutePart;
  if (total < 1) return { minutes: null, error: '공부 시간은 1분 이상 입력해 주세요' };
  if (total > STUDY_MINUTES_MAX) {
    return { minutes: null, error: '하루 공부 시간은 24시간 이내로 입력해 주세요' };
  }
  return { minutes: total, error: '' };
}

/** 저장값을 수정 시트의 시간/분 두 칸으로 되돌린다. 구버전·손상 값은 빈 칸으로 복구한다. */
export function splitStudyMinutes(value: unknown): { hours: string; minutes: string } {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > STUDY_MINUTES_MAX
  ) {
    return { hours: '', minutes: '' };
  }
  const hours = Math.floor(value / 60);
  return {
    hours: hours > 0 ? String(hours) : '',
    minutes: String(value % 60),
  };
}

/** 초안 JSON에서 꺼낸 입력 조각을 폼에 안전한 숫자 문자열로 되살린다. */
export function normalizeStudyTimeInputPart(value: unknown): string {
  return typeof value === 'string' && /^\d{0,2}$/.test(value) ? value : '';
}

/** 통계와 기록 카드가 공유하는 총 공부시간 문구. */
export function formatStudyMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (safe < 60) return `${safe}분`;
  const hours = Math.floor(safe / 60);
  const minutePart = safe % 60;
  return minutePart === 0 ? `${hours}시간` : `${hours}시간 ${minutePart}분`;
}
