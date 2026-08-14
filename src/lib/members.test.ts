/* 크루 명부의 정합성 — 멤버를 추가할 때 한 곳만 고치고 나머지를 빠뜨리면
   보드 정렬·아바타 조회(BY_ID)·데모 시드가 조용히 어긋난다. 그 회귀를 여기서 막는다.
   (표시 이름의 부분 문자열 충돌은 멘션 파서의 문제라 worker/notify.test.ts가 본다) */
import { describe, expect, it } from 'vitest';
import type { MemberId } from '../../shared/types';
import { MEMBER_IDS, MEMBER_NAMES, isOffTags, normalizeTags, primaryTag } from '../../shared/types';
import {
  BY_ID,
  COPY,
  MEMBERS,
  UNKNOWN_MEMBER_NAME,
  memberName,
  memberOf,
  membersOfEntries,
  seedComments,
  seedEntries,
  seedNotifications,
  seedReactionSets,
  seedStatuses,
} from './constants';

/** Avatar SVG의 얼굴 원(cx24 cy27 r12.5) 윗반원 — 모든 머리카락 path가 여기서 시작한다. */
const HAIR_CAP = 'M11.5 27a12.5 12.5 0 0 1 25 0';

describe('크루 명부', () => {
  it('MEMBERS는 MEMBER_IDS와 같은 순서로 빠짐없이 있다 — 보드·리액션 나열 순서의 기준', () => {
    expect(MEMBERS.map((m) => m.id)).toEqual([...MEMBER_IDS]);
  });

  it('모든 멤버에 표시 이름이 있고 서로 겹치지 않는다', () => {
    const names = MEMBER_IDS.map((id) => MEMBER_NAMES[id]);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(MEMBERS.map((m) => m.name)).toEqual(names);
  });

  it('BY_ID로 모든 멤버를 찾을 수 있다 — 아바타·이름 조회가 전부 이 맵을 지난다', () => {
    for (const id of MEMBER_IDS) expect(BY_ID[id].id).toBe(id);
  });

  it('색은 서로 구분돼야 한다 — 아바타 링·칩 색이 곧 사람 식별자다', () => {
    for (const key of ['color', 'soft'] as const) {
      const vals = MEMBERS.map((m) => m[key].toUpperCase());
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('머리카락 path는 얼굴 원 윗반원에서 시작해 닫힌다 — Avatar의 좌표계 규약', () => {
    for (const m of MEMBERS) {
      expect(m.hair.startsWith(HAIR_CAP)).toBe(true);
      expect(m.hair.endsWith('z')).toBe(true);
    }
  });

  it('도장 개수 문구는 멤버 수에서 파생된다 — 인원이 늘어도 숫자가 어긋나지 않게', () => {
    expect(COPY.count(2)).toBe(`${MEMBERS.length}명 중 2명 도장 찍음`);
  });
});

/* 크루에 사람이 늘면 배포 직후에도 열려 있는 구버전 번들이 그 사람의 기록·댓글·알림을
   계속 받는다. 그때 MEMBERS[0]으로 폴백하면 남의 기록이 승환의 이름·색·아바타로 붙는다. */
describe('모르는 멤버 폴백', () => {
  // 이 번들이 모르는 id — 다음 멤버가 추가된 뒤의 구버전 번들이 보는 것과 같은 상황이다
  const ghost = 'zz' as MemberId;

  it('MEMBERS[0]이 아니라 중립 표시로 떨어진다 — 남의 신원으로 대체하지 않는다', () => {
    const m = memberOf(ghost);
    const first = MEMBERS[0]!;
    expect(m.name).toBe(UNKNOWN_MEMBER_NAME);
    expect(m.name).not.toBe(first.name);
    expect(m.color).not.toBe(first.color);
    expect(m.soft).not.toBe(first.soft);
    expect(m.hair).not.toBe(first.hair);
    expect(m.id).toBe(ghost); // 받은 id는 그대로 — 키·비교가 다른 사람과 겹치면 안 된다
  });

  it('폴백 색이 크루 누구의 색과도 겹치지 않는다 — 색이 곧 사람 식별자다', () => {
    const m = memberOf(ghost);
    for (const key of ['color', 'soft'] as const) {
      expect(MEMBERS.map((x) => x[key].toUpperCase())).not.toContain(m[key].toUpperCase());
    }
  });

  it('폴백 이름은 비지 않는다 — 알림 문구가 "님이 …"로 시작하면 안 된다', () => {
    expect(memberName(ghost)).toBe(UNKNOWN_MEMBER_NAME);
    expect(UNKNOWN_MEMBER_NAME.length).toBeGreaterThan(0);
    expect(MEMBER_IDS.map((id) => MEMBER_NAMES[id])).not.toContain(UNKNOWN_MEMBER_NAME);
  });

  it('아는 멤버는 그대로 지나간다', () => {
    for (const id of MEMBER_IDS) {
      expect(memberOf(id)).toBe(BY_ID[id]);
      expect(memberName(id)).toBe(MEMBER_NAMES[id]);
    }
  });
});

/* 캘린더의 월간 색 점·선택일 아바타가 쓰는 규칙. 명부에서 출발해 거르면 모르는 멤버의
   기록이 통째로 탈락해, 그 사람만 기록한 날이 "아무도 기록 안 한 날"로 보인다. */
describe('기록에서 뽑은 멤버 목록', () => {
  const ghost = 'zz' as MemberId;
  const ghost2 = 'yy' as MemberId;
  const at = (m: MemberId) => ({ m });

  it('아는 멤버만 있으면 MEMBER_IDS 고정 순서로 나온다 — 기록 순서와 무관하게', () => {
    // 입력은 명부 역순 — 그래도 화면 순서는 크루 순서여야 한다
    const list = [...MEMBER_IDS].reverse().map(at);
    expect(membersOfEntries(list).map((m) => m.id)).toEqual([...MEMBER_IDS]);
    expect(membersOfEntries(list)).toEqual(MEMBERS); // 아는 멤버는 명부 객체 그대로
  });

  it('모르는 id도 빠지지 않고 중립 표시로, 아는 멤버 뒤에 온다', () => {
    // 모르는 멤버가 맨 앞에 와도 크루 순서를 밀어내지 않는다
    const out = membersOfEntries([at(ghost), at('th'), at('sh')]);
    expect(out.map((m) => m.id)).toEqual(['sh', 'th', ghost]);
    const last = out[out.length - 1]!;
    expect(last.name).toBe(UNKNOWN_MEMBER_NAME);
    expect(last.color).toBe(memberOf(ghost).color); // 회색 — 누구의 색도 주장하지 않는다
    expect(MEMBERS.map((m) => m.color)).not.toContain(last.color);
  });

  it('같은 멤버의 기록이 여러 개여도 한 번만 나온다', () => {
    const out = membersOfEntries([at('wg'), at('wg'), at(ghost), at('wg'), at(ghost)]);
    expect(out.map((m) => m.id)).toEqual(['wg', ghost]);
  });

  it('모르는 id가 여럿이면 처음 등장한 순서를 지킨다', () => {
    const out = membersOfEntries([at(ghost2), at('jj'), at(ghost), at(ghost2)]);
    expect(out.map((m) => m.id)).toEqual(['jj', ghost2, ghost]);
  });

  it('기록이 없으면 빈 목록 — 점도 아바타도 그리지 않는다', () => {
    expect(membersOfEntries([])).toEqual([]);
  });
});

describe('데모 시드', () => {
  const ids = new Set<string>(MEMBER_IDS);

  it('모든 멤버 시점에서 알림 시드가 만들어진다 — "본인 제외 3명" 같은 인원수 가정이 없어야 한다', () => {
    for (const me of MEMBER_IDS) {
      const rows = seedNotifications(me);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((n) => n.m === me)).toBe(true);
      expect(rows.every((n) => n.actor !== me)).toBe(true); // 내 알림의 행위자는 내가 아니다
      expect(rows.every((n) => n.actor === null || ids.has(n.actor))).toBe(true);
      expect(rows.every((n) => n.actors.every((a) => ids.has(a) && a !== me))).toBe(true);
      expect(new Set(rows.map((n) => n.id)).size).toBe(rows.length);
    }
  });

  it('시드가 가리키는 멤버·기록이 전부 실재한다', () => {
    const entries = seedEntries();
    const entryIds = new Set(entries.map((e) => e.id));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(entries.every((e) => ids.has(e.m))).toBe(true);
    expect(seedStatuses().every((s) => ids.has(s.m))).toBe(true);
    for (const c of seedComments()) {
      expect(ids.has(c.m)).toBe(true);
      expect(entryIds.has(c.entryId)).toBe(true);
    }
    for (const r of seedReactionSets()) {
      expect(ids.has(r.m)).toBe(true);
      expect(entryIds.has(r.entryId)).toBe(true);
    }
  });

  it('기록 시드의 태그가 정규화돼 있다 — 카드와 삭제 확인창의 대표 태그가 갈라지지 않게', () => {
    // 화면은 entryTags(=normalizeTags)로 대표 태그를 다시 계산하지만 ConfirmDelete는 e.tag를
    // 그대로 칩에 쓴다. 시드 리터럴이 TAGS 순서를 벗어나면 둘이 어긋나므로 여기서 막는다.
    for (const e of seedEntries()) {
      expect(e.tags.length).toBeGreaterThan(0);
      expect(e.tags).toEqual(normalizeTags(e.tags));
      expect(e.tag).toBe(primaryTag(e.tags));
      expect(e.stars === null).toBe(isOffTags(e.tags)); // 쉬는 날만 별점이 없다
    }
  });

  it('전원이 크루 보드에 등장한다 — 새 멤버만 시드가 비어 보이지 않게', () => {
    const seen = new Set<string>(seedEntries().map((e) => e.m));
    expect(MEMBER_IDS.filter((id) => !seen.has(id))).toEqual([]);
  });

  it('지금 상태는 일부만 켜져 있다 — 전원 on은 데모로 부자연스럽다', () => {
    const on = seedStatuses().filter((s) => s.on);
    expect(on.length).toBeGreaterThan(0);
    expect(on.length).toBeLessThan(MEMBERS.length);
  });
});
