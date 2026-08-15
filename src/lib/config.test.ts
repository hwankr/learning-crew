/* ?view= 해석 경계 — 특히 옛 라운지 딥링크가 "피드의 라운지 갈래"로 정확히 접히는지.
   (화면만 피드로 접으면 저장된 '기록' 필터가 글과 입구를 다 숨겨 링크의 뜻이 죽는다 —
    App은 lounge 플래그가 참일 때 저장 필터를 무시하고 posts로 연다.) */
import { describe, expect, it } from 'vitest';
import { parseViewParam } from './config';

describe('parseViewParam', () => {
  it('영/한 별칭을 해석하고 모르는 값은 null(저장된 탭 유지)', () => {
    expect(parseViewParam('feed')).toEqual({ view: 'feed', lounge: false });
    expect(parseViewParam('피드')).toEqual({ view: 'feed', lounge: false });
    expect(parseViewParam('cal')).toEqual({ view: 'cal', lounge: false });
    expect(parseViewParam('notiset')).toEqual({ view: 'noti', lounge: false });
    expect(parseViewParam('feeed')).toEqual({ view: null, lounge: false });
    expect(parseViewParam(null)).toEqual({ view: null, lounge: false });
  });

  it('옛 라운지 링크는 피드로 접되 라운지 갈래를 연다는 표식을 남긴다', () => {
    expect(parseViewParam('lounge')).toEqual({ view: 'feed', lounge: true });
    expect(parseViewParam('라운지')).toEqual({ view: 'feed', lounge: true });
  });
});
