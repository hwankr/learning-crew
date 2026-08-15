# 라운지(자유 게시판) — 설계 기록

2026-08-15. 디자인 원본: claude.ai/design 프로젝트 "자유 게시판 사진 기능"의 `라운지.dc.html`
(데스크톱 1180px + 모바일 390px 두 셸 프로토타입).

## 무엇인가
공부 기록(피드)이 아닌 자유 글 공간. 글 = 본문(≤2000자) + 사진(0~4장, Entry.photos와 같은
규약). **별점·태그·수정 없음** — 올리거나 지울 뿐이다. 글마다 댓글이 달린다(리액션 없음).

## 자리 — 전용 탭이 아니라 피드 안의 갈래 (2차 결정, 2026-08-15)
처음에는 디자인 원본대로 별도 탭(데스크톱 세그 3개, 모바일 탭 5개)으로 구현했으나,
**자유 글은 "가끔" 올라오는 것이라 전용 탭은 텅 비기 쉽다**는 사용자의 판단으로 피드에 합쳤다.
빈 탭은 안 만드는 것보다 나쁘고, 가끔 글은 모두가 이미 보는 피드에 실려야 읽힌다.
- 피드 날짜 묶음 안에 기록 카드와 글 카드가 시각 내림차순으로 섞인다(`feedDayGroups`).
  글의 날짜 축은 createdAt의 로컬 날짜 — 기록의 day와 같은 축이다.
- **구분**(중요 요구): 글 카드는 태그·별점 자리 대신 무채색 "라운지" 칩을 단다 —
  기록 카드의 태그 칩과 같은 문법이라 훑어볼 때 바로 갈린다. 시각도 기록처럼 HH:MM만.
- 필터 칩 전체/기록/라운지 — 보던 갈래는 lc-ui-v1(feedFilter)에 저장.
- **입구 두 개가 모드 선택을 대신한다**: CTA/FAB = "기록 남기기"(구조화된 기록),
  피드 상단 컴포저 행(아무거나…) = 자유 글. 시트 안에서 종류를 고르게 하지 않는다.
  컴포저 행은 기록만 보기(filter=entries)에서는 접는다.
- 내비게이션은 원래대로(데스크톱 세그 2개, 모바일 탭 4개). `?view=lounge`는 피드 별칭.

## 데이터 모델 — 왜 Comment 의미론인가
수정 기능이 없으므로 Entry의 rev/base CAS·3-way 병합이 통째로 불필요하다. 기존
Comment(내용 불변 + soft delete 단조)와 정확히 같은 규약을 썼다:
- `posts`·`post_comments` 테이블: 업서트는 INSERT + "내 행의 첫 삭제만" onConflict UPDATE.
  재전송 멱등, 삭제 후 부활 불가, 소유권은 setWhere가 SQL에서 강제.
- pull은 (updated_at, id) 키셋 + 90초 안전 지평선(`holdOrAdvance` 공유).
- push/pull 프로토콜: 기존 `/api/sync/*`에 스트림 2개 추가. 구버전 규약 유지 —
  "보냈는데 응답에 결과 필드가 없으면 구버전 Worker → 큐 보존".
- 댓글 스트림을 분리한 이유: 기존 comments의 키·인덱스·알림 팬아웃이 entryId 전제라
  (targetType, targetId)로 일반화하면 여섯 계층이 동시에 흔들린다.

## 사진
- 업로드 파이프라인(리사이즈 → IDB blob → XHR PUT → R2)을 그대로 재사용.
  `PhotoBlobRecord.entryId`는 이름만 유산이고 의미를 "소유 행 id(Entry 또는 Post)"로 넓혔다 —
  스토어의 `photoOwnerRow()`가 entries 맵 → posts 맵 순서로 소유자를 찾는다.
- 서버 톰스톤: 기존 트리거 함수 2개(`tombstone_entry_photos`/`filter_tombstoned_entry_photos`)가
  테이블 무관(NEW/OLD의 photos·member_id·deleted_at만 참조)이라 posts에 트리거만 추가.
- **빈 live 글 가드**(`tombstone_empty_live_posts`, 1단계 리뷰 P2): 사진만 있는 글이 filter
  트리거로 사진을 전부 잃으면 빈 행 대신 tombstone으로 강등 저장 — CHECK 제약이면 배치가
  통째로 500이라 큐가 영영 정산되지 않는다. 트리거는 이름 알파벳 순서로 filter_… 뒤에 온다.
- 카드 캐러셀은 kind=full + preview=thumb (268px 프레임이 DPR2에서 썸네일 400px 초과 —
  mosaicPhotoKind의 1~2장 근거와 동일, PhotoImg 뷰포트 게이트가 비용을 막는다).

## 클라이언트
- IDB v7: posts/postQueue/postComments/postCommentQueue (댓글과 같은 행/큐 분리).
- 스토어: 댓글 헬퍼(commentAckOutcome 등)를 `{updatedAt, deletedAt}` 구조 타입으로 넓혀
  세 스트림이 공유. applyPull/ack/refreshFromDB는 comments 블록과 같은 판정
  (큐 우선, 삭제 우선·부활 없음, IDB 저장 행 기준 정산).
- 스냅샷 파생(정렬·그룹핑)은 `loungeCache`로 메모이즈 — bump가 사진 진행률(장당 ~100회)에도
  오므로 두 맵이 실제로 바뀐 다음 bump에서만 재계산한다(2단계 리뷰 P3).
- UI: `Lounge.tsx`(목록/카드/컴포저/라이트박스/삭제확인). 댓글 조각(CommentList/CommentForm)은
  구조 타입으로 일반화해 피드 카드와 공유(IME Enter 규칙 포함). 본문 3줄 클램프 문턱은
  디자인 원본 판정 그대로(>76자 또는 개행). 컴포저는 기존 .sheet/.photo-grid 클래스 재사용.
- 라운지 컴포저에는 localStorage 초안이 없다(v1 범위 밖) — 닫으면 스테이징 사진을 즉시 버린다.
- **상단 세그는 디자인 원본의 밑줄 내비를 따른다**(투명 배경 + 활성 탭 노란 2.5px 밑줄):
  3단계 리뷰 때는 "기존 셸 관례(회색 컨테이너+흰 pill) 우선"으로 뒀으나, 통합 후 사용자
  피드백으로 디자인 원본 스타일로 교체했다(2026-08-15). 굵기 변화(600→800)에 탭 폭이
  흔들리지 않게 하는 data-label 고스트 기법은 그대로 유지.
- 카드 캐러셀의 내 미완료 사진: 배지는 안 달되(디자인에 없음) 상태는 구분한다 —
  done만 크게 보기, wait/up은 "올리는 중…" 정적 프레임, fail은 프레임 자체가 재시도 입구
  (업로드 큐의 fail은 retryPhoto만이 유일한 탈출구라 입구가 없으면 영구 실패).

## 범위 밖(백로그)
- 글 댓글 알림 팬아웃(notifyCommentEvents는 entryId 전제) — 별도 설계 필요.
- 라운지 카드의 업로드 진행/재시도 배지(피드 카드에는 있음).
- 컴포저 초안 지속, 글 수정.

## 검증
- PGlite 실 SQL 테스트(마이그레이션 0000→0011 순서 적용) + 스토어/동기화/컴포넌트 테스트,
  `npm run check` 3종. 스크린샷: lounge-desktop.png / lounge-mobile.png (Windows headless
  Chrome, dist의 manifest link 제거 후 촬영).
- 단계별 codex 리뷰 3회(Orca 오케스트레이션) — SESSIONS.md 참고.
