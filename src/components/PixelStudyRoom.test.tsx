import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STATUS_TTL_MS, type MemberId, type MemberStatus } from '../../shared/types';
import { PixelStudyRoom } from './PixelStudyRoom';

const now = Date.parse('2026-09-10T05:00:00.000Z');
function status(m: MemberId, place: MemberStatus['place'], ago = 60_000): MemberStatus {
  const since = new Date(now - ago).toISOString();
  return { m, on: true, place, since, lastStartedAt: since, updatedAt: since };
}

describe('pixel study scene', () => {
  it('renders known check-ins already seated on initial load, with no entrance replay', () => {
    const html = renderToStaticMarkup(<PixelStudyRoom statuses={{ wg: status('wg', '도서관') }} now={now} />);
    expect(html).toContain('1명 공부 중');
    expect(html).toContain('휴식 4명');
    expect(html).toContain('웅: 도서관에서 공부 중');
    expect(html).toContain('data-member="wg" data-activity="library" data-moving="false"');
    expect(html).not.toContain('data-moving="true"');
  });

  it('reports other study locations explicitly instead of counting them as resting or in the library', () => {
    const html = renderToStaticMarkup(<PixelStudyRoom statuses={{ sh: status('sh', '집'), jj: status('jj', '카페'), wg: status('wg', '도서관') }} now={now} />);
    expect(html).toContain('1명 공부 중');
    expect(html).toContain('휴식 2명 · 다른 장소 2명');
    expect(html).toContain('승환(집), 진주(카페)');
    expect(html).toContain('승환: 집에서 공부 중');
    expect(html).toContain('data-member="sh" data-activity="away"');
  });

  it('returns expired members to rest and provides an accessible motion control in compact mode', () => {
    const html = renderToStaticMarkup(<PixelStudyRoom statuses={{ wg: status('wg', '도서관', STATUS_TTL_MS) }} now={now} compact />);
    expect(html).toContain('0명 공부 중');
    expect(html).toContain('휴식 5명');
    expect(html).toContain('웅: 휴식 중');
    expect(html).toContain('aria-label="캐릭터 움직임 끄기"');
    expect(html).toContain('pixel-room-compact');
  });
});
