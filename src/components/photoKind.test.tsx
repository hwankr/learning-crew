/* 어떤 자리가 어떤 해상도를 요청하는지 — 정적 마크업에는 남지 않는다(URL이 아직 없어
   <img>가 그려지지 않는다). 그래서 usePhotoUrl 경계에서 요청한 kind를 기록해 확인한다.
   PhotoImg는 자리마다 훅을 두 번 부른다: 본 사진과, 그 사진을 기다리는 동안 깔 preview.
   preview가 없는 자리는 같은 kind가 한 번 더 기록되고 그 구독은 active=false다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, EntryPhoto } from '../../shared/types';
import { COPY } from '../lib/constants';
import { EntryCard, type EntryActions } from './EntryCard';
import { EMPTY_MODAL, EntryModal } from './EntryModal';

const photo = vi.hoisted(() => ({ kinds: [] as string[] }));

vi.mock('../lib/usePhoto', () => ({
  usePhotoUrl: (_photoId: string, kind: string) => {
    photo.kinds.push(kind);
    return { url: null, missing: false, status: 'idle' };
  },
}));

// useFocusTrap이 렌더 중 document.activeElement를 읽는다 — 시트를 세우려면 이것만 있으면 된다
vi.stubGlobal('document', { activeElement: null });

const PHOTO_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

function photos(n: number): EntryPhoto[] {
  return PHOTO_IDS.slice(0, n).map((id) => ({ id, w: 1600, h: 1200 }));
}

const entry: Entry = {
  id: 'e1', m: 'sh', day: '2026-08-14', time: '12:00',
  tag: '코딩테스트', tags: ['코딩테스트'], stars: 0, studyMinutes: null,
  memo: '', body: '오늘의 기록',
  todos: [], photos: [],
  v: 0, updatedAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
};

const actions: EntryActions = {
  onEdit: vi.fn(), onDelete: vi.fn(), onToggleTodo: vi.fn(),
  onAddComment: vi.fn(), onDeleteComment: vi.fn(), onToggleReaction: vi.fn(),
  onOpenPhoto: vi.fn(), onRetryPhoto: vi.fn(),
};

/** 사진 n장짜리 카드를 그리고 그 카드가 요청한 해상도만 돌려준다. */
function cardKinds(n: number, compact = false): string[] {
  photo.kinds.length = 0;
  renderToStaticMarkup(
    <EntryCard e={{ ...entry, photos: photos(n) }} compact={compact} mine meId="sh"
      editing={false} comments={[]} reactions={[]} photoUploads={new Map()} actions={actions} />,
  );
  return photo.kinds;
}

beforeEach(() => {
  photo.kinds.length = 0;
});

describe('피드 모자이크가 고르는 해상도', () => {
  it('칸이 큰 1~2장 배치는 표시용 원본을 받고 기다리는 동안 썸네일을 깐다', () => {
    expect(cardKinds(1)).toEqual(['full', 'thumb']);
    expect(cardKinds(2)).toEqual(['full', 'thumb', 'full', 'thumb']);
  });

  it('칸이 잘게 쪼개지는 3~4장은 전부 썸네일이다 — 큰 파일 네 개가 더 손해다', () => {
    expect(cardKinds(3)).not.toContain('full');
    expect(cardKinds(4)).not.toContain('full');
  });
});

describe('작은 자리는 장수와 무관하게 썸네일', () => {
  it('컴팩트(캘린더) 미리보기는 한 장짜리 카드라도 썸네일이다', () => {
    // 넓은 카드였다면 full을 받았을 1장 기록 — 좁은 열의 미리보기는 그대로 썸네일이다
    expect(cardKinds(1, true)).not.toContain('full');
    expect(cardKinds(4, true)).not.toContain('full');
  });

  it('작성 시트의 사진 타일도 썸네일이다', () => {
    renderToStaticMarkup(
      <EntryModal
        modal={{ ...EMPTY_MODAL, open: true, entryId: 'e1', day: '2026-08-14', photos: photos(2) }}
        patch={vi.fn()} close={vi.fn()} submit={vi.fn()} wit={COPY}
        demo={false} preparing={false} saving={false} durableStorage="ready"
        customTags={[]} onAddCustomTag={() => null} onRemoveCustomTag={() => undefined}
        fallbackRef={{ current: null }} onAddFiles={vi.fn()} onRemovePhoto={vi.fn()} />,
    );
    expect(photo.kinds.length).toBeGreaterThan(0);
    expect(photo.kinds).not.toContain('full');
  });
});

describe('작성 시트 공부시간 입력', () => {
  const sheet = (tags: string[] = ['영어']): string => renderToStaticMarkup(
    <EntryModal
      modal={{
        ...EMPTY_MODAL,
        open: true,
        entryId: 'e1',
        day: '2026-08-14',
        tags,
        stars: 4,
        studyHoursInput: '2',
        studyMinutesInput: '5',
      }}
      patch={vi.fn()} close={vi.fn()} submit={vi.fn()} wit={COPY}
      demo={false} preparing={false} saving={false} durableStorage="ready"
      customTags={[]} onAddCustomTag={() => null} onRemoveCustomTag={() => undefined}
      fallbackRef={{ current: null }} onAddFiles={vi.fn()} onRemovePhoto={vi.fn()} />,
  );

  it('시간/분을 숫자 키보드용 두 입력과 하나의 접근 가능한 그룹으로 묶는다', () => {
    const html = sheet();
    expect(html).toContain('class="study-time-row" role="group"');
    expect(html).toContain('공부 시간 중 시간');
    expect(html).toContain('공부 시간 중 분');
    expect(html.match(/inputMode="numeric"/g)).toHaveLength(2);
    expect(html).toContain('value="2"');
    expect(html).toContain('value="5"');
  });

  it('OFF에서는 직접 입력을 숨기고 생략 규칙을 알린다', () => {
    const html = sheet(['OFF']);
    expect(html).not.toContain('study-time-row');
    expect(html).toContain('쉬는 날은 만족도와 공부 시간 없이 기록돼요');
  });
});
