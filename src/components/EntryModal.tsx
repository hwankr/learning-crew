import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { EntryPhoto, Tag, Todo } from '../../shared/types';
import {
  ENTRY_PHOTO_LIMIT, PUSH_LIMITS, TAGS, TAG_LIMITS, isOffTags, normalizeCustomTagList, normalizeTags,
  sanitizeCustomTag,
} from '../../shared/types';
import { W, dayKey, pad2, tagMeta, type CopySet } from '../lib/constants';
import type { DurableStorageState } from '../local/store';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useOnline } from '../lib/useOnline';
import { CameraIcon, CheckMark, Icon, PLUS_D, STAR_D, X_D } from './icons';
import { PhotoImg } from './PhotoImg';

export interface ModalState {
  open: boolean;
  /** 신규도 시트를 여는 순간 UUID를 갖는다 — 선택한 blob의 entryId와 최종 Entry id가 같다. */
  entryId: string;
  editingId: string | null;
  /** 고른 공부 종류 — 다중 선택. 항상 normalizeTags를 지난 값(결정적 순서, 'OFF'면 단독). */
  tags: Tag[];
  stars: number;
  body: string;
  todos: Todo[];
  photos: EntryPhoto[];
  day: string; // YYYY-MM-DD — 새 기록도 지난 날짜를 고를 수 있다
}

export const EMPTY_MODAL: ModalState = {
  open: false, entryId: '', editingId: null, tags: [], stars: 0, body: '', todos: [], photos: [], day: '',
};

export function photoStorageNotice(args: {
  durableStorage: DurableStorageState;
  online: boolean;
  demo: boolean;
  full: boolean;
  hasPhotos: boolean;
}): { text: string; blocksAdd: boolean; tone: 'normal' | 'warn' | 'full' } {
  if (!args.demo && args.durableStorage !== 'ready') {
    if (!args.online) {
      return {
        text: '사진을 안전하게 보관할 수 없어 오프라인에서는 추가할 수 없어요.',
        blocksAdd: true,
        tone: 'warn',
      };
    }
    if (args.hasPhotos) {
      return {
        text: '임시 저장 상태예요. 업로드가 끝날 때까지 페이지를 닫지 마세요.',
        blocksAdd: false,
        tone: 'warn',
      };
    }
  }
  if (args.full) {
    return {
      text: '4장을 다 채웠어요. 빼면 다시 넣을 수 있어요.',
      blocksAdd: true,
      tone: 'full',
    };
  }
  if (!args.demo && !args.online && args.hasPhotos) {
    return {
      text: '오프라인 — 저장하면 대기 상태로 남고 연결되면 올라가요.',
      blocksAdd: false,
      tone: 'normal',
    };
  }
  return { text: '', blocksAdd: false, tone: 'normal' };
}

/** 태그 칩 토글 결과 — 'OFF'(쉬는 날)는 배타적이다.
    OFF를 켜면 나머지는 전부 빠지고, OFF가 켜진 채 다른 태그를 켜면 OFF가 빠진다.
    결과는 항상 normalizeTags를 지나 공용 결정 순서로 고정된다 — 순서가 흔들리면 내용이 같은
    기록이 서로를 "변경"으로 보고 헛 동기화가 돈다. */
export function toggledTags(cur: readonly Tag[], t: Tag): Tag[] {
  if (cur.includes(t)) return normalizeTags(cur.filter((x) => x !== t));
  return withTag(cur, t);
}

/** 태그를 켜기만 한다 — 이미 켜져 있으면 그대로. 방금 만든 태그를 바로 고른 상태로 만들 때
    toggledTags를 쓰면, 그 이름이 이미 붙어 있던 기록(목록에서 지웠다 다시 추가한 경우)에서
    "추가했더니 꺼진다"가 된다. OFF 배타 규칙은 토글과 같은 뜻이다. */
export function withTag(cur: readonly Tag[], t: Tag): Tag[] {
  return normalizeTags(t === 'OFF' ? ['OFF'] : [...cur.filter((x) => x !== 'OFF'), t]);
}

/** 이 태그를 이 기록에 더 넣을 자리가 있는가 — 기록당 한도(TAG_LIMITS.perEntry).
    normalizeTags가 넘치는 만큼을 잘라 주지만 그 절단은 경계 방어지 화면의 규칙이 아니다.
    피커가 절단에 기대면 아홉 번째 태그의 운명이 이름 순서로 갈린다: 코드포인트가 큰 이름은
    잘려 나가 "눌러도 켜지지 않고", 작은 이름은 이미 고른 태그 하나를 조용히 밀어내고 켜진다.
    둘 다 사용자가 한 적 없는 일이라, 자리가 없으면 토글·추가를 아예 막고 이유를 말한다.
    끄기와 이미 켜진 태그는 자리를 새로 먹지 않고, OFF는 나머지를 전부 비우고 혼자 남는다.
    이름이 정화되지 않는 값(빈 문자열·너무 긴 이름)은 한도가 아니라 검증이 막을 몫이라
    여기서는 통과시킨다 — 한도 문구가 진짜 실패 사유를 가리면 안 된다.
    cur은 항상 normalizeTags를 지난 값이다(ModalState.tags의 계약). */
export function hasTagRoom(cur: readonly Tag[], t: Tag): boolean {
  const tag = sanitizeCustomTag(t);
  if (tag === null || tag === 'OFF' || cur.includes(tag)) return true;
  return cur.length < TAG_LIMITS.perEntry;
}

/** 피커에 늘어놓을 태그와, 그중 내가 목록에서 뺄 수 있는 것.
    기본 5개 → 내 커스텀 태그 → "목록에서는 지웠지만 이 기록에는 아직 붙어 있는" 태그 순서다.
    마지막 무리(ghosts)를 빼면 지운 태그가 달린 과거 기록을 수정할 때 그 태그가 칩으로 보이지
    않는 채로 다시 저장된다 — 화면에 없는 선택은 끌 수도 없다. 지울 수 있는 건 내 목록에 있는
    것뿐이라, 기본 태그와 이 유령 태그에는 × 배지가 붙지 않는다.
    ghosts를 따로 돌려주는 건 "다시 등록할 수 있는 이름"이 정확히 이 무리이기 때문이다
    (canOpenTagAdd). normalizeCustomTagList가 기본 태그와 정화되지 않는 이름을 이미 걸러 준다. */
export function pickerTags(
  custom: readonly string[],
  selected: readonly Tag[],
): { all: Tag[]; removable: Set<Tag>; ghosts: Tag[] } {
  const mine = normalizeCustomTagList(custom);
  const ghosts = normalizeCustomTagList(selected.filter((t) => !mine.includes(t)));
  return { all: [...TAGS, ...mine, ...ghosts], removable: new Set(mine), ghosts };
}

/** '+ 추가' 입력을 열 수 있는가 — 피커의 세 입구(칩 토글 · 입력 열기 · 확정) 중 가운데.
    나머지 둘은 이름을 알고 hasTagRoom으로 판정하는데, 여는 시점에는 이름이 아직 없다.
    그래서 "지금 이 기록에 넣을 수 있는 이름이 하나라도 있는가"로 같은 뜻을 미리 묻는다.
    자리가 남았으면 언제나 열린다. 꽉 찼어도 유령 태그(이 기록에는 붙어 있는데 내 목록에는
    없는 이름)를 다시 등록하는 길은 열어 둔다 — 재등록은 선택 수를 늘리지 않아 한도와
    무관한데(hasTagRoom도 이미 켜진 태그를 통과시킨다), 여기서 막으면 태그 여덟 개를 고른
    기록에서는 그 이름을 영영 내 목록으로 되살릴 수 없다.
    커스텀 태그 개수 한도(perMember)는 여기서 보지 않는다 — 한도 문구가 진짜 실패 사유를
    가리면 안 되므로 그건 onAddCustomTag가 말할 몫이다(hasTagRoom의 정화 규칙과 같은 이유). */
export function canOpenTagAdd(selected: readonly Tag[], custom: readonly string[]): boolean {
  if (selected.length < TAG_LIMITS.perEntry) return true;
  return pickerTags(custom, selected).ghosts.length > 0;
}

/* 칩 하나의 어림 폭 — 칩은 재지 않고 스타일시트에 박힌 값에서 계산한다
   (.tag-chip: 13px/700 · 좌우 패딩 14px · 테두리 1.5px 둘, .tag-chips gap 6px).
   줄 수를 정하는 건 칩 개수가 아니라 이름 길이라, 개수로 끊으면 12자 태그 서넛이 네 줄이
   되도록 "+n"이 뜨지 않는다. 칩마다 관측을 붙이는 대신, 재는 것은 줄이 접히는 기준인
   컨테이너 폭 하나뿐이다(EntryModal의 chipsRef) — 그 값이 틀리면 판정이 통째로 틀리지만,
   칩 폭은 몇 px 어긋나도 줄 수가 좀처럼 바뀌지 않는다. */
const CHIP_FONT = 13;
const CHIP_PAD = 14 * 2 + 1.5 * 2;
const CHIP_GAP = 6;
/** 라틴·숫자·기호는 한글보다 좁다 — 13px 굵은 글씨에서 대략 0.58배. */
const NARROW = 0.58;
/** 한 글자가 글자 크기만큼을 먹는 글자 — 한글·한자·가나·전각·이모지. */
const WIDE_RE =
  /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7A3\uFF01-\uFF60]|[\u{1F300}-\u{1FAFF}]/u;

/** 아직 재기 전에 쓰는 기준 폭 — 390px 화면의 시트 안쪽(좌우 패딩 20px).
    화면마다 다른 값이라 상수로 둘 수 없다: 360px 화면의 안쪽은 320px이고, 거기서는 이 값으로
    두 줄이라 판정한 조합이 실제로 세 줄이 되어 "+n"이 뜨지 않는다. 진짜 판정은 컨테이너를 잰
    폭으로 하고(collapsedChips의 width), 이 값은 첫 렌더와 레이아웃이 없는 곳(테스트)의 기본값. */
export const PICKER_WIDTH = 350;
export const PICKER_ROWS = 2;

/** 칩 하나의 어림 폭(px). */
export function chipWidth(name: string): number {
  let w = CHIP_PAD;
  for (const ch of name) w += WIDE_RE.test(ch) ? CHIP_FONT : CHIP_FONT * NARROW;
  return w;
}
/** '+ 추가' 칩 — 아이콘(13) + 간격(5)이 붙고 좌우 패딩이 1px씩 좁다. */
const ADD_W = chipWidth('추가') + 13 + 5 - 2;
/** '+n' 칩 — n이 한 자리든 두 자리든 한 글자 차이라 넉넉한 쪽으로 고정한다. */
const MORE_W = chipWidth('+12');

/** 칩 폭을 flex-wrap과 같은 탐욕 규칙으로 접어 줄 수를 센다. */
function chipRows(widths: readonly number[], width: number): number {
  let rows = 1;
  let cur = 0;
  for (const w of widths) {
    if (cur === 0) cur = w;
    else if (cur + CHIP_GAP + w > width) { rows += 1; cur = w; }
    else cur += CHIP_GAP + w;
  }
  return rows;
}

/** 태그 칩들이 뒤따르는 고정 칩(+n · + 추가)까지 합쳐 두 줄 안에 들어가는가. */
function fitsRows(tags: readonly Tag[], tail: readonly number[], width: number): boolean {
  return chipRows([...tags.map(chipWidth), ...tail], width) <= PICKER_ROWS;
}

/** 접힘/펼침 상태의 칩 목록.
    개수가 아니라 어림 폭으로 끊는다 — "대략 두 줄을 넘으면 접는다"가 계약인데, 줄 수는
    이름 길이가 정하기 때문이다(12자 태그 세 개면 기본 5개와 합쳐 네 줄이 된다).
    '+ 추가' 칩은 편집 모드에서 잠깐 사라지지만 폭에서 빼지 않는다 — 편집을 켰다 끌 때마다
    감춰지는 태그가 달라지면 목록이 발밑에서 움직인다.
    선택된 태그는 접혀도 반드시 남는다 — 안 보이는 선택은 없는 선택으로 읽힌다. 선택만으로
    두 줄이 넘으면 두 계약이 부딪히는데, 그때는 선택을 살린다.
    width는 칩이 실제로 접히는 컨테이너의 안쪽 폭이다 — 화면 폭마다 다르므로 시트가 재서 넘기고,
    재기 전에는 390px 화면 기준값(PICKER_WIDTH)으로 판정한다. */
export function collapsedChips(
  all: readonly Tag[],
  selected: readonly Tag[],
  expanded: boolean,
  width: number = PICKER_WIDTH,
): { shown: Tag[]; hidden: number; collapsible: boolean } {
  const collapsible = !fitsRows(all, [ADD_W], width);
  if (!collapsible || expanded) return { shown: [...all], hidden: 0, collapsible };
  const on = new Set(selected);
  const keep = new Set(all.filter((t) => on.has(t)));
  // 앞에서부터 한 개씩 넣어 보고 두 줄을 넘기는 첫 칩에서 멈춘다 — 넘치는 칩만 건너뛰면
  // 목록이 원래 순서와 다른 자리에서 끊겨 어디까지 보고 있는지가 흐려진다.
  for (const t of all) {
    if (keep.has(t)) continue;
    if (!fitsRows(all.filter((x) => keep.has(x) || x === t), [MORE_W, ADD_W], width)) break;
    keep.add(t);
  }
  const shown = all.filter((t) => keep.has(t));
  return { shown, hidden: all.length - shown.length, collapsible };
}

/** 저장 문턱과 막힌 이유 — 두 단계로 나뉘어 있던 검사("다음"의 내용 검사, 저장의 태그·별점
    검사)가 시트가 한 장이 되면서 저장 버튼 하나로 모였다. 뜻은 그대로다:
    태그 하나 이상 + (쉬는 날이거나 별점 하나 이상), 그리고 새 기록은 글/할 일/사진이 있어야 한다
    (수정은 예외 — 내용을 지우는 것도 수정이다).
    이유는 채울 순서대로 하나만 돌려준다 — 한 번에 다 늘어놓으면 무엇부터 손대야 할지 흐려진다. */
export function saveGate(
  m: Pick<ModalState, 'editingId' | 'tags' | 'stars' | 'body' | 'todos' | 'photos'>,
  /** 고른 사진을 아직 리사이즈하는 중 — 곧 내용이 될 사진을 두고 "한 줄 적어주세요"라고
      막지 않는다. 저장은 준비가 끝난 뒤에 이어서 실행된다(App이 대기시킨다). */
  preparing = false,
): {
  canSave: boolean;
  hasContent: boolean;
  blocked: string;
} {
  const ready = m.tags.length > 0 && (isOffTags(m.tags) || m.stars > 0);
  const hasContent = !!m.body.trim() || m.todos.some((t) => t.t.trim()) || m.photos.length > 0;
  const canSave = ready && (hasContent || preparing || !!m.editingId);
  const blocked = !m.tags.length ? '무엇을 했는지 골라주세요'
    : !ready ? '만족도를 골라주세요'
      : !canSave ? '기록을 한 줄 적거나 사진을 넣어주세요' : '';
  return { canSave, hasContent, blocked };
}

const CHEVRON_D = 'M6 9l6 6 6-6';
const PREV_D = 'M15 18l-6-6 6-6';
const NEXT_D = 'M9 6l6 6-6 6';

function parseDay(key: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number);
  return { y, m: m - 1, d };
}

function DatePicker({
  sel, onPick,
}: {
  sel: { y: number; m: number; d: number };
  onPick: (day: string) => void;
}) {
  const [view, setView] = useState({ y: sel.y, m: sel.m });
  const now = new Date();
  const t0 = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const isCurMonth = view.y === t0.y && view.m === t0.m;
  const first = new Date(view.y, view.m, 1).getDay();
  const dim = new Date(view.y, view.m + 1, 0).getDate();

  return (
    <div className="cal-pop">
      <div className="cal-pop-head">
        <span className="cal-pop-title">{view.y}년 {view.m + 1}월</span>
        <div className="cal-nav">
          <button className="icon-btn sm" onClick={() =>
            setView(view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 })}
            aria-label="이전 달">
            <Icon d={PREV_D} size={14} sw={2.4} />
          </button>
          <button className="icon-btn sm" disabled={isCurMonth} aria-label="다음 달" onClick={() =>
            setView(view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 })}>
            <Icon d={NEXT_D} size={14} sw={2.4} />
          </button>
        </div>
      </div>
      <div className="cal-pop-week">
        {W.map((w, i) => (
          <span key={w} className={'cal-pop-wd' + (i === 0 ? ' sun' : '')}>{w}</span>
        ))}
      </div>
      <div className="cal-pop-grid">
        {Array.from({ length: first }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: dim }, (_, i) => {
          const n = i + 1;
          const isToday = isCurMonth && n === t0.d;
          const isSel = view.y === sel.y && view.m === sel.m && n === sel.d;
          const isFuture = view.y > t0.y || (view.y === t0.y && (view.m > t0.m || (view.m === t0.m && n > t0.d)));
          return (
            <button
              key={n}
              className={'cal-pop-day' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
              disabled={isFuture}
              onClick={() => onPick(`${view.y}-${pad2(view.m + 1)}-${pad2(n)}`)}
            >
              <span className="cal-pop-num">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EntryModal({
  modal, patch, close, submit, wit, demo, preparing, saving, durableStorage,
  customTags, onAddCustomTag, onRemoveCustomTag,
  fallbackRef, onAddFiles, onRemovePhoto,
}: {
  modal: ModalState;
  patch: (p: Partial<ModalState>) => void;
  close: () => void;
  submit: () => void;
  wit: CopySet;
  /** 데모는 네트워크가 없다 — 사진이 즉시 done이라 오프라인 안내가 거짓말이 된다 */
  demo: boolean;
  /** 고른 사진을 리사이즈하는 중 — 저장을 눌러도 App이 끝날 때까지 기다렸다 이어 간다 */
  preparing: boolean;
  /** 삭제된 기록을 새 기록으로 살리며 blob을 복제하는 중 — 저장 스냅샷이 바뀌지 않게 잠근다. */
  saving: boolean;
  durableStorage: DurableStorageState;
  /** 내가 만든 태그 — 이 시트에만 선택지로 뜬다(다른 멤버의 피커는 건드리지 않는다). */
  customTags: string[];
  /** 실패하면 사유 문구를, 성공하면 null을 돌려준다. 검증 규칙은 여기 한 곳에만 있고
      시트는 그 문구를 그대로 보여 준다 — 규칙을 화면에 베끼면 둘이 갈라진다. */
  onAddCustomTag: (name: string) => string | null;
  onRemoveCustomTag: (name: string) => void;
  /** 열었던 수정 버튼이 닫는 사이 사라질 수 있다 — 날짜를 바꿔 저장하면 카드가 다른 날 묶음으로
      옮겨가고, 다른 기기에서 그 기록이 지워질 수도 있다. 그때 초점이 갈 자리. */
  fallbackRef: RefObject<HTMLElement | null>;
  /** 고른 파일을 리사이즈해 시트에 붙인다 — 자리 계산·실패 안내는 App이 맡는다
      (스토어와 토스트가 거기 있고, 시트는 그 결과만 그린다) */
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
}) {
  const [todoOpen, setTodoOpen] = useState(modal.todos.length > 0);
  const [calOpen, setCalOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  /* 태그 피커의 세 상태 — 셋 다 시트가 닫히면 함께 사라진다(컴포넌트가 언마운트된다).
     펼침이 시트 세션 동안 유지된다는 계약이 곧 이 자리다. */
  const [tagAdd, setTagAdd] = useState(false); // 인라인 입력 열림
  const [tagEdit, setTagEdit] = useState(false); // × 배지가 보이는 편집 모드
  const [tagExpanded, setTagExpanded] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagError, setTagError] = useState('');
  const addBtnRef = useRef<HTMLButtonElement>(null);
  /* 저장이 막힌 이유는 한 번 눌러 본 뒤부터 보여준다 — 빈 시트를 열자마자 "골라주세요"가
     떠 있으면 아직 시작도 안 한 사람을 다그치는 꼴이 된다. */
  const [tried, setTried] = useState(false);
  const typeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typeTimer.current), []);

  const titleId = useId();
  const bodyId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [pickerWidth, setPickerWidth] = useState(PICKER_WIDTH);
  useFocusTrap(sheetRef, fallbackRef);
  const online = useOnline();

  /* 시트가 통째로 하나로 굴러가므로 본문 칸 안에 또 스크롤이 생기면 스크롤이 두 겹이 된다 —
     내용만큼 칸이 자라게 매번 다시 잰다. border-box라 scrollHeight(테두리 제외)만 넣으면
     테두리 두께만큼 모자라 다시 스크롤이 남는다. */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [modal.body]);

  /* 접힘 판정의 기준이 되는 칩 줄의 안쪽 폭 — 본문 높이 재기와 같은 자리(레이아웃 직후,
     그리기 전)에서 잰다. 상수로 두면 화면마다 틀린다: 390px 화면 기준의 350은 360px 화면
     (안쪽 320px)에서 세 줄짜리 조합을 두 줄로 보아 "+n"을 내놓지 않고, 데스크톱(408px)에서는
     반대로 한두 칩 일찍 접는다. 컨테이너에 패딩이 없어 clientWidth가 곧 접히는 폭이다.
     한 번만 재지 않는 이유: 시트가 열려 있는 동안에도 이 폭이 변한다 — 본문이 길어져 시트에
     세로 스크롤바가 생기면 데스크톱에서 폭이 줄고, 기기를 돌리면 통째로 바뀐다. 관측은 이 한
     곳뿐이고 폭을 읽기만 하므로 되먹임이 없다(같은 값이면 React가 렌더를 건너뛴다).
     폭이 0인 곳(레이아웃이 없는 환경)에서는 기본값을 그대로 둔다 — 0으로 재면 모든 칩이
     제 줄을 차지해 늘 접힌 것처럼 보인다. */
  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setPickerWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = parseDay(modal.day || dayKey(new Date()));
  const selDow = new Date(sel.y, sel.m, sel.d).getDay();
  const isToday = modal.day === dayKey(new Date());
  const dateSuffix = modal.editingId ? '· 수정 중' : isToday ? '· 오늘' : '· 지난 기록';

  const isOff = isOffTags(modal.tags);
  const { canSave, hasContent, blocked } = saveGate(modal, preparing);
  const showBlocked = tried && !!blocked;

  const { all: pickerAll, removable } = pickerTags(customTags, modal.tags);
  const { shown, hidden, collapsible } = collapsedChips(pickerAll, modal.tags, tagExpanded, pickerWidth);
  /* 지울 게 하나도 없으면 편집 모드는 존재하지 않는다 — 토글이 사라진 뒤에도 켜져 있으면
     다음에 태그를 하나 추가하는 순간 편집 모드가 혼자 되살아난다. */
  const tagEditing = tagEdit && removable.size > 0;
  const closeTagAdd = () => {
    setTagAdd(false);
    setTagName('');
    setTagError('');
  };
  /* 이 기록에 태그를 더 넣을 자리가 없다 — 새로 고르는 것도, 만들어 바로 고르는 것도 막는다.
     이유는 눌러 본 뒤에 말한다(저장 문턱의 draft-note와 같은 규칙): 여덟 개를 고른 것 자체는
     잘못이 아니라 다 채운 것뿐이라, 가만히 있는 사람에게 빨간 줄을 띄우지 않는다.
     세 입구가 같은 뜻을 쓴다: 칩 토글·확정은 이름을 알아 hasTagRoom으로, 입력 열기는 이름이
     없어 canOpenTagAdd로 — 그래서 유령 태그 재등록은 꽉 찬 기록에서도 세 입구 모두 통과한다. */
  const canAddTag = canOpenTagAdd(modal.tags, customTags);
  const sayTagFull = () => setTagError(
    `태그는 ${TAG_LIMITS.perEntry}개까지예요. 하나 빼면 다시 고를 수 있어요.`,
  );
  const toggleTag = (t: Tag) => {
    if (!hasTagRoom(modal.tags, t)) {
      sayTagFull();
      return;
    }
    setTagError('');
    patch({ tags: toggledTags(modal.tags, t) });
  };
  const addTag = () => {
    // 입력을 연 뒤에 여덟 번째 태그를 고를 수 있으니 확정 직전에 자리를 다시 본다
    if (!hasTagRoom(modal.tags, tagName)) {
      sayTagFull();
      return;
    }
    const reason = onAddCustomTag(tagName);
    if (reason) {
      setTagError(reason);
      return;
    }
    // 만들자마자 고른 상태로 — 방금 적은 이름을 칩 목록에서 다시 찾아 누르게 하지 않는다
    patch({ tags: withTag(modal.tags, tagName) });
    closeTagAdd();
    addBtnRef.current?.focus();
  };
  const removeTag = (t: Tag) => {
    onRemoveCustomTag(t);
    if (removable.size <= 1) setTagEdit(false);
  };
  /* 실패 사유와 편집 안내가 한 자리를 나눠 쓴다 — 둘 다 칩 아래 잔글씨고, 동시에 할 말이
     있는 상황이 아니다(편집을 켜면 입력이 닫히고, 입력을 열면 편집이 꺼진다). */
  const tagNote = tagError
    || (tagEditing ? '지운 태그는 선택지에서만 빠져요 — 과거 기록에는 그대로 남아요.' : '');

  const photoFull = modal.photos.length >= ENTRY_PHOTO_LIMIT;
  const photoNotice = photoStorageNotice({
    durableStorage,
    online,
    demo,
    full: photoFull,
    hasPhotos: modal.photos.length > 0 || preparing,
  });

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (saving) return;
      // 안쪽에서 펼친 것부터 하나씩 닫는다 — 태그를 적다 만 채로 시트가 통째로 닫히면
      // 쓰던 기록까지 같이 사라진 것처럼 보인다
      if (calOpen) setCalOpen(false);
      else if (tagAdd) {
        setTagAdd(false);
        setTagName('');
        setTagError('');
        addBtnRef.current?.focus();
      } else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [calOpen, close, saving, tagAdd]);

  return (
    <div className="overlay compose-overlay" onClick={saving ? undefined : close}>
      {/* 트랩은 Tab만 가둔다 — 화면 낭독기에 "여기가 모달"이라고 알리는 건 dialog 의미다 */}
      <div className="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={saving} inert={saving || undefined}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head-row">
          <h2 className="sheet-title" id={titleId}>
            {/* 지난 날짜를 골라 놓고 "오늘"이라고 부르지 않는다 — 바로 아래 날짜 줄과 어긋난다 */}
            {modal.editingId ? '기록 수정' : isToday ? '오늘 기록 남기기' : '기록 남기기'}
          </h2>
          <button className="icon-btn sheet-close" onClick={close} aria-label="닫기">
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        {/* 팝오버는 이 줄을 기준으로 뜬다 — 시트 기준이면 아래로 굴린 뒤에 연 달력이
            화면 밖(시트 맨 위)에 열린다 */}
        <div className="sheet-date-wrap">
          <button className="sheet-date-btn" onClick={() => setCalOpen(!calOpen)} aria-expanded={calOpen}>
            <span className="sheet-date-main">{sel.m + 1}월 {sel.d}일 {W[selDow]}요일</span>
            <span className="sheet-date-suffix">{dateSuffix}</span>
            <Icon d={CHEVRON_D} size={14} sw={2.4} />
          </button>
          {calOpen && (
            <DatePicker
              sel={sel}
              onPick={(day) => { patch({ day }); setCalOpen(false); }}
            />
          )}
        </div>

        <div className="sheet-label-row">
          <span className="sheet-label">무엇을 했나요</span>
          {/* 지울 수 있는 태그가 생기기 전에는 편집이라는 말 자체가 없다 */}
          {removable.size > 0 && (
            <button
              className="todo-toggle"
              aria-pressed={tagEditing}
              onClick={() => {
                setTagEdit(!tagEditing);
                closeTagAdd();
              }}
            >
              {tagEditing ? '완료' : '편집'}
            </button>
          )}
        </div>
        {/* ref는 접힘 판정의 기준 폭을 재는 자리다 — 칩이 실제로 접히는 줄이 여기다 */}
        <div className={'tag-chips' + (tagEditing ? ' editing' : '')} ref={chipsRef}
          role="group" aria-label="무엇을 했나요">
          {shown.map((t) => {
            const on = modal.tags.includes(t);
            const tm = tagMeta(t);
            const paint = on ? { background: tm.bg, color: tm.fg, borderColor: tm.fg } : undefined;
            /* 편집 중에는 어떤 칩도 토글이 아니다 — 버튼인 채로 두면 지우려고 켠 모드에서
               탭 한 번이 선택을 바꾼다. 누를 수 있는 것은 × 하나뿐이라고 보이게 한다. */
            if (tagEditing) {
              return (
                <span key={t} className={'tag-chip' + (removable.has(t) ? ' removable' : ' locked')} style={paint}>
                  {t}
                  {removable.has(t) && (
                    <button className="tag-chip-x" aria-label={`${t} 태그 지우기`} onClick={() => removeTag(t)}>
                      <Icon d={X_D} size={10} sw={3} />
                    </button>
                  )}
                </span>
              );
            }
            /* 자리가 없어 켤 수 없는 칩은 눌리는 것처럼 보이지 않게 흐려 둔다. 초점은 그대로
               받는다 — disabled로 빼면 왜 안 되는지 물어볼 자리조차 없어진다. */
            const noRoom = !on && !hasTagRoom(modal.tags, t);
            return (
              <button
                key={t}
                className={'tag-chip' + (noRoom ? ' limit' : '')}
                aria-pressed={on}
                aria-disabled={noRoom || undefined}
                style={paint}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            );
          })}
          {((tagExpanded && collapsible) || hidden > 0) && (
            <button
              className="tag-chip tag-chip-more"
              aria-expanded={tagExpanded}
              aria-label={tagExpanded ? '태그 접기' : `태그 ${hidden}개 더 보기`}
              onClick={() => setTagExpanded(!tagExpanded)}
            >
              {tagExpanded ? '접기' : `+${hidden}`}
            </button>
          )}
          {!tagEditing && (
            <button
              ref={addBtnRef}
              className={'tag-chip tag-chip-add' + (!canAddTag && !tagAdd ? ' limit' : '')}
              aria-expanded={tagAdd}
              aria-disabled={(!canAddTag && !tagAdd) || undefined}
              onClick={() => {
                /* 닫는 쪽은 한도와 상관없이 늘 된다 — 입력을 열어 둔 채 여덟 번째 태그를
                   골랐다고 해서 열어 놓은 칸을 닫지도 못하게 되면 갇힌다.
                   여는 쪽은 넣을 수 있는 이름이 하나도 없을 때만 막는다: 만들면 곧바로 고른
                   상태가 되는 게 추가의 계약이라, 고를 자리가 없는데 적게 한 뒤에 "안 된다"고
                   하면 헛수고를 시킨 셈이다. 반대로 재등록할 유령 태그가 남아 있으면 꽉 찬
                   기록에서도 연다 — 그 이름은 자리를 새로 먹지 않는다. */
                if (tagAdd) closeTagAdd();
                else if (!canAddTag) sayTagFull();
                else {
                  setTagError('');
                  setTagAdd(true);
                }
              }}
            >
              <Icon d={PLUS_D} size={13} sw={2.4} />
              추가
            </button>
          )}
        </div>
        {/* 시트는 한 장짜리 흐름이다 — 태그를 만들자고 모달 위에 모달을 얹지 않는다 */}
        {tagAdd && !tagEditing && (
          <div className="tag-add">
            <input
              className="tag-add-input"
              value={tagName}
              aria-label="새 태그 이름"
              placeholder={`태그 이름 (${TAG_LIMITS.nameLen}자까지)`}
              /* 규칙이 아니라 손이 미끄러지는 걸 막는 턱이다. maxLength는 UTF-16 code unit을
                 세는데 공용 검증은 코드포인트를 세므로, 그대로 12를 넣으면 규칙이 허용하는
                 이모지 7~12자 이름이 입력 단계에서 잘려 나간다. 코드포인트 하나가 최대 두
                 unit이라 두 배로 열어 두면 규칙보다 좁아지는 일이 없다 — 진짜 판정과 문구는
                 onAddCustomTag(= 공용 sanitize)가 낸다. */
              maxLength={TAG_LIMITS.nameLen * 2}
              autoFocus
              onChange={(ev) => {
                setTagName(ev.target.value);
                if (tagError) setTagError('');
              }}
              onKeyDown={(ev) => {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                addTag();
              }}
            />
            <button className="tag-add-go" onClick={addTag}>추가</button>
          </div>
        )}
        {tagNote && (
          <div className={'tag-hint' + (tagError ? ' warn' : '')} role="status" aria-live="polite">
            {tagNote}
          </div>
        )}

        <div className="sheet-label">오늘 만족도</div>
        {!isOff ? (
          <div className="star-row" role="group" aria-label="오늘 만족도">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="star-btn" aria-label={`${n}점`}
                aria-pressed={modal.stars === n} onClick={() => patch({ stars: n })}>
                <svg width={22} height={22} viewBox="0 0 24 24" style={{ display: 'block' }}>
                  <path d={STAR_D} fill={n <= modal.stars ? '#FFB800' : '#E4E7EC'} />
                </svg>
              </button>
            ))}
            <span className="star-count" aria-live="polite">
              {modal.stars ? `${modal.stars} / 5` : '눌러서 선택'}
            </span>
          </div>
        ) : (
          <span className="off-note">{wit.offNote}</span>
        )}

        <label className="sheet-label" htmlFor={bodyId}>기록</label>
        <textarea
          id={bodyId}
          ref={bodyRef}
          className="modal-diary"
          value={modal.body}
          placeholder={wit.diaryPh}
          maxLength={PUSH_LIMITS.body}
          autoFocus
          onChange={(ev) => {
            clearTimeout(typeTimer.current);
            typeTimer.current = setTimeout(() => setTyping(false), 900);
            setTyping(true);
            patch({ body: ev.target.value });
          }}
        />

        <div className="sheet-label-row">
          <span className="sheet-label">사진</span>
          <span className={'photo-count' + (photoFull ? ' full' : '')}>
            {modal.photos.length}/{ENTRY_PHOTO_LIMIT}
          </span>
        </div>
        <div className="photo-grid">
          {modal.photos.map((p, i) => (
            <span className="photo-tile" key={p.id}>
              <PhotoImg photoId={p.id} kind="thumb" alt={`첨부한 사진 ${i + 1}`} icon={20}
                immediate />
              <button className="photo-drop" aria-label="이 사진 빼기" onClick={() => onRemovePhoto(p.id)}>
                <Icon d={X_D} size={10} sw={3} />
              </button>
            </span>
          ))}
          {/* 프로토타입의 "사진 선택" 모달 대신 OS 파일 선택기를 연다 — 고르는 자리는
              브라우저가 이미 갖고 있고, 우리가 흉내 낼 수 있는 것도 아니다 */}
          <button
            className="photo-add"
            aria-label="사진 추가"
            disabled={photoFull || photoNotice.blocksAdd}
            onClick={() => fileRef.current?.click()}
          >
            <CameraIcon size={19} />
          </button>
          <input
            ref={fileRef}
            className="photo-file"
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(ev) => {
              const files = [...(ev.target.files ?? [])];
              // 같은 파일을 빼고 다시 골라도 change가 오도록 비운다
              ev.target.value = '';
              if (files.length) onAddFiles(files);
            }}
          />
        </div>
        {photoNotice.text && (
          <div
            className={'photo-hint' + (photoNotice.tone === 'normal' ? '' : ` ${photoNotice.tone}`)}
            role="status"
            aria-live="polite"
          >
            {photoNotice.text}
          </div>
        )}

        <div className="sheet-label-row">
          <span className="sheet-label">할 일</span>
          <button
            className="todo-toggle"
            aria-expanded={todoOpen}
            aria-label={todoOpen ? '할 일 목록 접기' : modal.todos.length ? `할 일 목록 펼치기 (${modal.todos.length})` : '할 일 목록 추가'}
            onClick={() => {
              if (!todoOpen && !modal.todos.length) patch({ todos: [{ t: '', done: false }] });
              setTodoOpen(!todoOpen);
            }}
          >
            {todoOpen ? '접기' : modal.todos.length ? `펼치기 (${modal.todos.length})` : '목록 추가'}
          </button>
        </div>
        {todoOpen && (
          <div className="modal-todos">
            {modal.todos.map((t, i) => (
              <div className="modal-todo-row" key={i}>
                <button
                  className={'todo-check modal-check' + (t.done ? ' done' : '')}
                  aria-label={t.done ? '완료 해제' : '완료로 표시'}
                  onClick={() =>
                    patch({ todos: modal.todos.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })
                  }
                >
                  <CheckMark size={12} />
                </button>
                <input
                  className={'modal-todo-input' + (t.done ? ' done' : '')}
                  value={t.t}
                  placeholder={wit.todoPh}
                  maxLength={PUSH_LIMITS.todoText}
                  autoFocus={i === modal.todos.length - 1 && !t.t}
                  onChange={(ev) =>
                    patch({ todos: modal.todos.map((x, j) => (j === i ? { ...x, t: ev.target.value } : x)) })
                  }
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    if (i === modal.todos.length - 1 && t.t.trim() && modal.todos.length < PUSH_LIMITS.todos) {
                      patch({ todos: [...modal.todos, { t: '', done: false }] });
                    }
                  }}
                />
                <button
                  className="modal-todo-remove"
                  aria-label="이 할 일 지우기"
                  onClick={() => patch({ todos: modal.todos.filter((_, j) => j !== i) })}
                >
                  <Icon d={X_D} size={13} sw={2.4} />
                </button>
              </div>
            ))}
            {modal.todos.length < PUSH_LIMITS.todos && (
              <button className="add-todo" onClick={() => patch({ todos: [...modal.todos, { t: '', done: false }] })}>
                <Icon d={PLUS_D} size={13} sw={2.4} />
                <span>항목 추가</span>
              </button>
            )}
          </div>
        )}

        <div className="sheet-foot">
          {/* 초안 표시와 "왜 저장이 안 되는지"가 한 자리를 나눠 쓴다 — 둘 다 버튼 옆 잔글씨고,
              동시에 할 말이 있는 상황이 아니다(저장이 막혀 있으면 그게 먼저다) */}
          <span className={'draft-note' + (showBlocked ? ' warn' : '')} role="status" aria-live="polite">
            {showBlocked ? blocked
              : saving ? '기록 살리는 중…'
                : preparing ? '사진 준비 중…'
                : hasContent ? (typing ? '쓰는 중…' : '초안 저장됨') : ''}
          </span>
          <button className="cancel-btn" onClick={close}>취소</button>
          <button
            className={'submit' + (canSave ? ' ready' : '')}
            aria-disabled={!canSave}
            aria-busy={preparing || saving}
            onClick={() => { if (canSave) submit(); else setTried(true); }}
          >
            {modal.editingId ? wit.editSubmit : wit.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
