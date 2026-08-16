/* 일정 등록 시트 — 크루 전원의 캘린더에 함께 서는 약속을 남긴다.
   모달 규약은 기록 시트(EntryModal)와 같다: 포커스 트랩·Escape·오버레이 클릭으로 닫기.
   초안 지속은 없다(라운지 시트와 같은 급) — 닫으면 쓰던 내용은 함께 사라진다.
   수정 UI도 없다: 일정은 등록하거나 지울 뿐이다. */
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  EVENT_LIMITS, MEMBER_IDS, TAG_LIMITS, normalizeCustomEventTagList, sanitizeCustomTag,
  type CrewEvent, type MemberId, type Tag,
} from '../../shared/types';
import { EVENT_TAGS, MEMBERS, tagMeta, type CopySet } from '../lib/constants';
import { dayDiff, dayLabel, eventSpanLabel, eventWhenLabel, shiftDay } from '../lib/events';
import { useFocusTrap } from '../lib/useFocusTrap';
import { Chip } from './Chip';
import { Avatar, Icon, LEFT_D, PLUS_D, RIGHT_D, X_D } from './icons';

/** 시트가 App에 넘기는 값 — id·소유자·리비전은 App이 채운다(시트는 화면만 안다). */
export interface EventDraft {
  title: string;
  tag: Tag;
  /** 일정 당사자 — 최소 한 명(시트가 보장한다), MEMBER_IDS 고정 순서 */
  participants: MemberId[];
  memo: string;
  day: string;
  /** 하루 일정은 null */
  endDay: string | null;
}

/** 제출 경계는 화면용 공백만 정리하고 고른 태그는 그대로 App에 넘긴다. */
export function submittedEventDraft(
  title: string,
  tag: Tag,
  participants: readonly MemberId[],
  memo: string,
  day: string,
  endDay: string | null,
): EventDraft {
  return {
    title: title.trim(),
    tag,
    /* 고른 차례가 아니라 크루 차례로 넘긴다 — 대표(participants[0])의 색이 셀 알약에 서고
       아바타 스택도 이 순서를 그대로 쓴다. 누가 먼저 눌렸는지에 따라 화면이 달라지면 안 된다. */
    participants: MEMBER_IDS.filter((id) => participants.includes(id)),
    memo: memo.trim(),
    day,
    endDay,
  };
}

/** 일정에 고를 수 있는 기본 태그 — 기록용 TAGS('영어'·'코딩테스트'…)는 "무엇을 했나"의 말이라
    약속에는 뜻이 없다. 여기 없는 이름은 각자 만들어 쓴다(customTags). */
const BASE_TAGS: Tag[] = [...EVENT_TAGS];

/** 종료일이 시작일에서 멀어질 수 있는 한계 — 넘기면 서버 정규화가 endDay를 버려
    기간으로 등록한 일정이 하루짜리로 저장된다. */
const SPAN_MAX = EVENT_LIMITS.spanDays;

/** 네이티브 날짜 선택기 열기 — 스테퍼로는 몇 달 뒤가 멀다.
    showPicker가 없거나(구버전) 제스처 밖이면 입력 자체에 초점을 준다: 그 자리에서 직접 고를 수 있다. */
function openDatePicker(el: HTMLInputElement | null): void {
  if (!el) return;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
      return;
    } catch {
      // 사용자 제스처 밖·미지원 — 아래 초점 폴백으로 흐른다
    }
  }
  el.focus();
}

export function EventSheet({
  prefillDay, meId, customTags, fallbackRef, onSubmit, onAddCustomTag, onRemoveCustomTag, onClose,
}: {
  /** 선택일 패널에서 열면 그 날, 홈·헤더에서 열면 오늘 */
  prefillDay: string;
  /** 나 — 참여 인원의 기본값이다(대부분의 일정은 내 일정이다) */
  meId: MemberId;
  /** 내가 만든 일정 태그 — 기록용 목록과 따로 논다(운동·영어 같은 기록의 말이 약속 칸에
      섞이지 않게). 추가·삭제 규약은 기록 시트와 같고 목록만 다르다. */
  customTags: string[];
  /** 시트를 연 버튼이 닫는 사이 사라질 수 있다 — 그때 초점이 갈 자리 */
  fallbackRef: RefObject<HTMLElement | null>;
  onSubmit: (draft: EventDraft) => void;
  /** 실패 사유를 돌려준다(성공은 null) — 문구는 공용 검증이 정한다 */
  onAddCustomTag: (name: string) => string | null;
  onRemoveCustomTag: (name: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const startPickerRef = useRef<HTMLInputElement>(null);
  const endPickerRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  // 기본은 목록 첫 칸의 '자격증' — 일정으로 남길 만한 약속의 대부분이 시험 날짜다(디자인)
  const [tag, setTag] = useState<Tag>('자격증');
  const [range, setRange] = useState(false);
  const [day, setDay] = useState(prefillDay);
  const [endDay, setEndDay] = useState(prefillDay);
  const [tagAdd, setTagAdd] = useState(false); // 인라인 입력 열림
  const [tagName, setTagName] = useState('');
  const [tagError, setTagError] = useState('');
  const [tagEdit, setTagEdit] = useState(false);
  // 열 때는 나 혼자다 — 대부분의 일정은 내 일정이고, 함께 치는 시험만 사람을 더 켠다
  const [who, setWho] = useState<MemberId[]>([meId]);
  const [whoNote, setWhoNote] = useState('');

  useFocusTrap(sheetRef, fallbackRef);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // 안쪽에서 펼친 것부터 하나씩 닫는다(기록 시트와 같은 규칙) — 태그를 적다 만 채로
      // 시트가 통째로 닫히면 쓰던 일정까지 같이 사라진다
      if (tagAdd) {
        setTagAdd(false);
        setTagName('');
        setTagError('');
        addBtnRef.current?.focus();
      } else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, tagAdd]);

  /* 시작일을 종료일 뒤로 옮기면 종료일이 따라온다 — 뒤집힌 기간을 손으로 고치게 두지 않는다.
     반대로 멀어질 때는 한도까지만 끌고 간다(넘기면 기간이 조용히 사라진다). */
  const moveStart = (next: string) => {
    setDay(next);
    setEndDay((end) =>
      end < next ? next : dayDiff(next, end) > SPAN_MAX ? shiftDay(next, SPAN_MAX) : end,
    );
  };
  const moveEnd = (next: string) => {
    if (next < day) return setEndDay(day);
    setEndDay(dayDiff(day, next) > SPAN_MAX ? shiftDay(day, SPAN_MAX) : next);
  };

  // 기간을 골랐어도 종료일이 시작일 이하면 하루 일정이다 — 저장되는 값이 화면의 말과 같아야 한다
  const savedEnd = range && endDay > day ? endDay : null;
  const canSubmit = title.trim().length > 0;

  /* 칩 차례: 기본 3개 → 내 태그 → "방금 목록에서 지웠는데 아직 골라 둔" 이름.
     마지막 자리(유령)를 빼면 고른 태그가 화면에서 사라지는데, 안 보이는 선택은 없는 선택으로
     읽힌다 — 기록 시트의 pickerTags와 같은 뜻이다. 지울 수 있는 건 내 목록에 있는 것뿐이라
     기본 태그와 유령에는 × 배지가 붙지 않는다. */
  // 동기화한 구버전/다른 클라이언트가 OFF를 넣었어도 일정 선택지에는 절대 노출하지 않는다.
  const mine = normalizeCustomEventTagList(customTags, EVENT_TAGS);
  const ghost = BASE_TAGS.includes(tag) || mine.includes(tag) ? [] : [tag];
  const pickerTags = [...BASE_TAGS, ...mine, ...ghost];
  /* 지울 게 하나도 없으면 편집 모드는 존재하지 않는다 — 토글이 사라진 뒤에도 켜져 있으면
     다음에 태그를 하나 추가하는 순간 편집 모드가 혼자 되살아난다. */
  const tagEditing = tagEdit && mine.length > 0;
  const closeTagAdd = () => {
    setTagAdd(false);
    setTagName('');
    setTagError('');
  };
  const addTag = () => {
    const reason = onAddCustomTag(tagName);
    if (reason) {
      setTagError(reason);
      return;
    }
    // 만들자마자 고른 상태로 — 방금 적은 이름을 칩 목록에서 다시 찾아 누르게 하지 않는다.
    // 목록에 들어간 이름은 정화를 거친 쪽이라 여기서도 같은 함수로 맞춘다(추가가 통과했으므로 null이 아니다).
    const made = sanitizeCustomTag(tagName);
    if (made !== null) setTag(made);
    closeTagAdd();
    addBtnRef.current?.focus();
  };
  const removeTag = (t: Tag) => {
    onRemoveCustomTag(t);
    if (mine.length <= 1) setTagEdit(false);
  };
  /* 마지막 한 명은 끌 수 없다 — 아무도 없는 일정은 누구의 캘린더에도 설 자리가 없다.
     막는 대신 이유를 눌러 본 뒤에 말한다(기록 시트의 태그 한도와 같은 규칙): 한 명만 켠 것
     자체는 잘못이 아니라 대부분의 일정이 그러므로, 가만히 있는 사람에게 빨간 줄을 띄우지 않는다.
     본인을 끄는 것은 막지 않는다 — 남의 시험 날짜를 대신 등록하는 길이 그것뿐이다. */
  const toggleWho = (id: MemberId) => {
    const on = who.includes(id);
    if (on && who.length <= 1) {
      setWhoNote('함께하는 크루는 최소 한 명이에요.');
      return;
    }
    setWhoNote('');
    // 켤 때는 크루 차례로 다시 세운다 — 화면에 서는 차례가 누른 차례를 따라가면 안 된다
    setWho(on ? who.filter((x) => x !== id) : MEMBER_IDS.filter((x) => x === id || who.includes(x)));
  };
  /* 실패 사유와 편집 안내가 한 자리를 나눠 쓴다 — 둘 다 칩 아래 잔글씨고, 동시에 할 말이
     있는 상황이 아니다(편집을 켜면 입력이 닫히고, 입력을 열면 편집이 꺼진다). */
  const tagNote = tagError
    || (tagEditing ? '지운 태그는 선택지에서만 빠져요 — 이미 등록한 일정에는 그대로 남아요.' : '');

  return (
    <div className="overlay compose-overlay" onClick={onClose}>
      <div className="sheet event-sheet" ref={sheetRef} role="dialog" aria-modal="true"
        aria-labelledby={titleId} onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-head-row">
          <h2 className="sheet-title" id={titleId}>일정 등록</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="닫기">
            <Icon d={X_D} size={17} sw={2.4} />
          </button>
        </div>
        <div className="event-sheet-sub">등록하면 크루 전원의 캘린더에 함께 보여요</div>

        <label className="sheet-label" htmlFor={`${titleId}-t`}>무슨 일정</label>
        {/* 기록 시트(EntryModal)의 본문 칸과 같은 규약 — 열리면 첫 입력이 초점을 가져간다.
            초점이 시트 밖에 남으면 Escape 말고는 키보드로 들어올 길이 없다(트랩은 Tab만 가둔다).
            돌아갈 자리는 useFocusTrap이 기억한다: autoFocus는 커밋 단계라 이미 늦지 않다. */}
        <input className="event-input lead" id={`${titleId}-t`} value={title}
          maxLength={EVENT_LIMITS.title} autoFocus
          placeholder="정보처리기사 실기 · 면접…"
          onChange={(ev) => setTitle(ev.target.value)} />

        <div className="sheet-label-row">
          <span className="sheet-label">언제</span>
          {/* 인디케이터는 배경에 깔린 한 겹이고 버튼 둘이 그 위에 선다 — 300ms 동안 미끄러진다 */}
          <div className="event-seg" role="group" aria-label="일정 기간">
            <span className={'event-seg-ind' + (range ? ' right' : '')} aria-hidden="true" />
            <button className={'event-seg-btn' + (range ? '' : ' on')} aria-pressed={!range}
              onClick={() => setRange(false)}>하루</button>
            <button className={'event-seg-btn' + (range ? ' on' : '')} aria-pressed={range}
              onClick={() => setRange(true)}>기간</button>
          </div>
        </div>
        <div className="event-date-row">
          {/* 라벨 자체가 네이티브 선택기의 입구다 — 몇 달 뒤 시험을 ▶로만 가게 두지 않는다 */}
          <button className="event-date-label" onClick={() => openDatePicker(startPickerRef.current)}>
            {dayLabel(day)}
          </button>
          <input ref={startPickerRef} className="event-date-native" type="date" value={day}
            tabIndex={-1} aria-hidden="true"
            onChange={(ev) => { if (ev.target.value) moveStart(ev.target.value); }} />
          <button className="icon-btn event-step" aria-label="시작일 하루 앞으로"
            onClick={() => moveStart(shiftDay(day, -1))}>
            <Icon d={LEFT_D} size={16} sw={2.4} />
          </button>
          <button className="icon-btn event-step" aria-label="시작일 하루 뒤로"
            onClick={() => moveStart(shiftDay(day, 1))}>
            <Icon d={RIGHT_D} size={16} sw={2.4} />
          </button>
        </div>
        {range && (
          <div className="event-date-row end">
            <span className="event-date-tag">종료</span>
            <button className="event-date-label" onClick={() => openDatePicker(endPickerRef.current)}>
              {dayLabel(endDay)}
            </button>
            <input ref={endPickerRef} className="event-date-native" type="date" value={endDay}
              min={day} tabIndex={-1} aria-hidden="true"
              onChange={(ev) => { if (ev.target.value) moveEnd(ev.target.value); }} />
            <button className="icon-btn event-step" aria-label="종료일 하루 앞으로"
              onClick={() => moveEnd(shiftDay(endDay, -1))}>
              <Icon d={LEFT_D} size={16} sw={2.4} />
            </button>
            <button className="icon-btn event-step" aria-label="종료일 하루 뒤로"
              onClick={() => moveEnd(shiftDay(endDay, 1))}>
              <Icon d={RIGHT_D} size={16} sw={2.4} />
            </button>
          </div>
        )}

        <div className="sheet-label-row">
          <span className="sheet-label">관련 태그</span>
          {/* 지울 수 있는 태그가 생기기 전에는 편집이라는 말 자체가 없다 */}
          {mine.length > 0 && (
            <button className="todo-toggle" aria-pressed={tagEditing}
              onClick={() => {
                setTagEdit(!tagEditing);
                closeTagAdd();
              }}>
              {tagEditing ? '완료' : '편집'}
            </button>
          )}
        </div>
        {/* 기록과 달리 하나만 고른다 — 일정은 "무엇을 했나"가 아니라 "무슨 약속인가"다 */}
        <div className={'tag-chips' + (tagEditing ? ' editing' : '')} role="group" aria-label="관련 태그">
          {pickerTags.map((t) => {
            const on = t === tag;
            const tm = tagMeta(t);
            /* 채움 색은 태그마다 달라 인라인이지만(캘린더 점 색과 같은 기준), 고른 칩의
               투명 테두리는 늘 같은 값이라 클래스가 맡는다 */
            const paint = on ? { background: tm.bg, color: tm.fg } : undefined;
            /* 편집 중에는 어떤 칩도 토글이 아니다(span) — 지우려고 켠 모드에서 탭 한 번이
               고른 태그를 바꾸면 안 된다. 누를 수 있는 것은 × 하나뿐이라고 보이게 한다.
               span에는 aria-pressed가 없어 고름 표시를 .on이 대신 맡는다. */
            if (tagEditing) {
              return (
                <span key={t}
                  className={'tag-chip' + (on ? ' on' : '') + (mine.includes(t) ? ' removable' : ' locked')}
                  style={paint}>
                  {t}
                  {mine.includes(t) && (
                    <button className="tag-chip-x" aria-label={`${t} 태그 지우기`} onClick={() => removeTag(t)}>
                      <Icon d={X_D} size={10} sw={3} />
                    </button>
                  )}
                </span>
              );
            }
            return (
              <button key={t} className="tag-chip" aria-pressed={on} style={paint}
                onClick={() => setTag(t)}>
                {t}
              </button>
            );
          })}
          {!tagEditing && (
            <button ref={addBtnRef} className="tag-chip tag-chip-add" aria-expanded={tagAdd}
              onClick={() => {
                /* 한도(TAG_LIMITS.perMember)로는 여는 쪽을 막지 않는다 — 일정은 태그를 하나만
                   고르니 "이 일정에 넣을 자리"가 찰 일이 없고, 목록이 꽉 찬 사유는 확정할 때
                   onAddCustomTag가 제 문구로 말한다. */
                if (tagAdd) closeTagAdd();
                else {
                  setTagError('');
                  setTagAdd(true);
                }
              }}>
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
              /* 규칙이 아니라 손이 미끄러지는 걸 막는 턱이다 — 코드포인트를 세는 공용 검증보다
                 좁아지지 않게 두 배로 열어 둔다(기록 시트와 같은 이유). */
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

        {/* 태그와 달리 여럿을 켠다 — "A자격증 시험을 승환·웅·태현이 다 같이 친다"가 일정 하나다.
            지우는 권한은 여기서 갈리지 않는다: 참여자로 들어가도 삭제는 등록한 사람의 몫이다. */}
        <span className="sheet-label">함께하는 크루</span>
        <div className="tag-chips who-chips" role="group" aria-label="함께하는 크루">
          {MEMBERS.map((m) => {
            const on = who.includes(m.id);
            /* 켠 칩만 그 사람의 색을 입는다(soft 채움 + 제 색 테두리 — 아바타 링과 같은 색이라
               칩 하나가 한 사람으로 읽힌다). 사람마다 다른 값이라 인라인이고, 안 켠 칩은
               기본 .tag-chip 그대로다(흰 배경·#E4E7EC). */
            const paint = on ? { background: m.soft, borderColor: m.color } : undefined;
            return (
              <button key={m.id} className="tag-chip who-chip" aria-pressed={on}
                /* 마지막 한 명은 눌러도 안 꺼진다 — 초점은 그대로 받는다(disabled로 빼면
                   왜 안 되는지 물어볼 자리조차 없어진다) */
                aria-disabled={(on && who.length <= 1) || undefined}
                style={paint} onClick={() => toggleWho(m.id)}>
                <Avatar m={m} size={22} />
                {m.name}
              </button>
            );
          })}
        </div>
        {whoNote && (
          <div className="tag-hint warn" role="status" aria-live="polite">{whoNote}</div>
        )}

        <label className="sheet-label" htmlFor={`${titleId}-m`}>메모 한 줄</label>
        <input className="event-input" id={`${titleId}-m`} value={memo}
          maxLength={EVENT_LIMITS.memo}
          placeholder="놓치지 말 것, 준비물, 시간…"
          onChange={(ev) => setMemo(ev.target.value)} />

        {/* 빈 제목으로도 등록되면 캘린더에 이름 없는 네모만 남는다 — 제목이 곧 일정이다 */}
        <button className={'submit event-submit' + (canSubmit ? ' ready' : '')} disabled={!canSubmit}
          onClick={() => onSubmit(submittedEventDraft(title, tag, who, memo, day, savedEnd))}>
          {eventSpanLabel(day, savedEnd)}에 등록
        </button>
      </div>
    </div>
  );
}

/** 일정 삭제 확인 — 기록 삭제와 같은 규약(취소에 기본 초점, Escape·오버레이로 닫기).
    무엇이 지워지는지 보여준다: 기간 일정은 누른 날과 시작일이 다를 수 있다. */
export function EventConfirmDelete({
  event, wit, fallbackRef, onCancel, onConfirm,
}: {
  event: CrewEvent;
  wit: CopySet;
  fallbackRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(boxRef, fallbackRef);

  // 기본 초점은 취소 — 열리자마자 누른 Enter가 곧바로 삭제로 이어지면 안 된다
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay confirm-overlay" onClick={onCancel}>
      <div className="confirm" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="confirm-title" id={titleId}>{wit.eventDelAsk}</div>
        <div className="confirm-card">
          <div className="confirm-card-head">
            <Chip tag={event.tag} variant="sm2" />
            <span className="confirm-card-when">{eventWhenLabel(event.day, event.endDay)}</span>
          </div>
          <div className="confirm-card-excerpt">{event.title}</div>
        </div>
        <div className="confirm-note">{wit.eventDelNote}</div>
        <div className="confirm-btns">
          <button className="confirm-btn cancel" ref={cancelRef} onClick={onCancel}>취소</button>
          <button className="confirm-btn danger" onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  );
}
