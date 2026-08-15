# 라운지 — 세션·리뷰 기록

## 2026-08-15 — 최초 구현 (Claude, Orca 오케스트레이션 run_eae562363ffa)

디자인 임포트: claude.ai/design "자유 게시판 사진 기능" → `라운지.dc.html`(1,132줄) 분석.
4단계 구현, 각 단계마다 codex 리뷰 워커를 디스패치(worker-start → worker_done 대기)했다.

### 1단계 — 데이터 레이어 (서버)
shared/types.ts(Post/PostComment/프로토콜), worker/schema.ts, migrations/0011(+톰스톤 트리거),
worker/queries.ts(push/pull ×2), worker/index.ts(검증·배선), sync.test.ts(PGlite) 테스트.

**codex 리뷰 (task_d5f818c1feea) — 수정 필요 → 전부 반영:**
- [P2] 사진만 있는 live 글이 filter 트리거로 사진을 전부 잃으면 빈 live 행으로 저장됨
  → `tombstone_empty_live_posts` 트리거(빈 live 행을 tombstone으로 강등) + 회귀 테스트.
- [P3] 본문 한도를 trim 전 원문으로 검사 → trim 결과 기준 + 원문 2배 상한.
- [P3] psince/pcsince 시각 형식 미검증(깨진 값이 timestamptz 캐스트 500)
  → Date.parse 검증 + 핸들러 경계 테스트(index.test.ts).

### 2단계 — 로컬 스토어·동기화 (클라이언트)
idb.ts v7(스토어 4개), store.ts(헬퍼 제네릭화·UI 쓰기·applyPull·ack·refreshFromDB·
photoOwnerRow 일반화·데모 시드), sync.ts(배치·커서), postStore.test.ts(신규)·sync.test.ts.

**codex 리뷰 (task_7f1cd19e4ae8) — 수정 필요 → 반영:**
- [P2] addPost/addPostComment UUID 소문자 정규화 누락(대문자 id면 ACK 상관 실패·중복)
  → canonicalUuid 경계 적용 + 회귀 테스트.
- [P2] 행 없이 커서만 실린 반쪽 pull 응답에서 라운지 커서가 선행 전진
  → pRows/pcRows 유효할 때만 전진 + 회귀 테스트(500행 페이지 루프).
- [P2] refreshFromDB가 "이번에 처음 본 blob"만 업로드 큐잉 — 소유 행이 나중에 오면 인계 누락
  → 미완료(wait/up) 첨부 전체 스캔으로 교체(queuePhoto 멱등).
- [P3] Post 채택이 404 재시도 예산 재무장에서 빠짐 → applyPull 글 채택도 플래그 반영.
- [P3] bump마다 라운지 전량 재정렬 → loungeCache 메모(변이 지점마다 무효화).
- [P3] 테스트 공백 → 상기 회귀 + 글 댓글 push 정산 테스트 추가.
  (실 IDB 다중 탭 hold/gone 통합 테스트는 기존 comments 스트림과 같은 수준으로 보류 —
   현 테스트 인프라에 fake-indexeddb가 없다. 백로그.)

### 3단계 — UI
Lounge.tsx(목록/카드/컴포저/라이트박스/삭제확인), TopBar 세그 3개·CTA 전환, TabBar 5탭,
Fab 라운지 변형, uiState/config(?view=lounge), COPY 확장, styles.css 라운지 섹션,
CommentList/CommentForm 일반화, useFocusTrap document 가드, Lounge.test.tsx.

**codex 리뷰 (task_d091b440e597) — 수정 필요 → 반영:**
- [P1] 업로드 상태가 카드에 전달되지 않아 wait/up/fail 사진도 "크게 보기" 버튼이었다
  (라이트박스 목록은 shownPhotos=done뿐이라 클릭 무반응/점프, fail은 재시도 입구 없이 영구 실패)
  → photoUploads 전달: done만 크게 보기, wait/up은 "올리는 중…" 정적 프레임,
  fail은 프레임=재시도 입구(onRetryPhoto). 정적 마크업 테스트 추가.
- [P2] 컴포저에 photoStorageNotice 보호 누락(메모리 폴백에서 사진 유일본 경고·오프라인 차단)
  → demo/durableStorage/useOnline 전달로 기록 시트와 같은 안내·차단 공용화 + 테스트.
- [P2] 라이트박스가 단장 교체뿐 — 원본의 스와이프/scroll-snap 부재
  → light-track 페이지 트랙(스크롤↔버튼↔키보드가 한 인덱스 상태로 동기화).
- [P3] 컴포저가 5열 유동 photo-grid 재사용(84px 고정 타일·라벨 아님)
  → lounge-photo-grid/tile/add(84px, "사진 추가" 라벨)로 교체.
- [P3] 상단 세그가 원본의 밑줄 내비와 다름 → 앱 기존 세그 관례 유지로 **결정**, DESIGN.md에 기록.
- [P3] 상호작용(App 수준) 테스트 부재 → 현 테스트 인프라(jsdom 없음, 정적 SSR+순수 함수)의
  관례상 백로그로 남김. 정적으로 가능한 회귀(업로드 상태 마크업·보호 안내)는 추가.
이상 없음 확인: CommentList/CommentForm 일반화·PhotoLightbox 호출부·uiState/config 배선·
컴포저 close의 사진 정리·photoSession/pin 경로.

### 4단계 — 검증
- `npm run check` 3종 + `npm test`(vitest) 전부 통과.
- `npm run build` 성공. 헤드리스 스크린샷(데모 모드 ?user=승환&view=lounge):
  lounge-desktop.png(1280px)·lounge-mobile.png(390px iframe 하네스) — 세그/탭/FAB/
  컴포저 행/클램프+더 보기/댓글/내 글 삭제 버튼/라이브 점 모두 디자인과 일치 확인.

### 5단계 — 피드 통합 (사용자 방향 전환)
"라운지가 텅 빌 가능성이 높다"는 판단으로 전용 탭을 접고 피드에 합쳤다(DESIGN.md 2차 결정).
- Feed.tsx: `feedDayGroups`(기록×글 혼합 정렬, 순수 함수) + 필터 칩(전체/기록/라운지,
  uiState.feedFilter 저장) + 자유 글 입구(LoungeComposerRow).
- Lounge.tsx: 목록 화면 제거, PostCard 공개(+무채색 "라운지" 칩, 시각만 표기),
  컴포저/라이트박스/삭제확인은 그대로 피드 위 오버레이로 산다.
- 내비 복귀: 세그 2개·탭 4개·FAB 기록 전용, `?view=lounge`→피드 별칭.
- 데이터·동기화 계층 변경 없음. 스크린샷: merged-desktop.png / merged-mobile.png.

**codex 리뷰 (task_db5ba772ac02, 재시도 ctx_f5c6bd002e98) — 수정 필요 → 전부 반영:**
- [P2] 라운지만 보기(posts 필터) 중 기록 저장·알림→피드 이동 뒤 대상 기록이 숨음
  → `revealEntries(filter)`(uiState) — 기록으로 향하는 동작 뒤 posts면 all로 전환. 테스트 추가.
- [P2] 자유 글 입구 라벨(#B4BAC4, 1.95:1)·라운지 칩(#6B7280/#F1F3F6, 4.35:1) AA 미달
  → 입구 #6B7280, 칩 전경 #4E555F(≥4.5:1)로 조정.
- [P3] 옛 ?view=lounge가 저장된 '기록' 필터와 충돌해 링크의 뜻이 죽음
  → parseViewParam이 lounge 표식을 남기고 App이 저장 필터보다 우선해 posts로 초기화. 테스트 추가.
- [P3] 교차 종류 동일 id의 React key·정렬 2차 키 충돌 가능
  → key `e:<id>`/`p:<id>`, 정렬 키에 종류 삽입. 같은 분·같은 id 결정성 테스트 추가.
- [P3] entries 배열이 bump마다 새 참조라 혼합 정렬 useMemo가 무관한 갱신에도 재계산
  → entriesCache(라운지 캐시와 같은 방식, adoptEntry/adoptMissingEntry/upsert/remove 무효화).
- [P3] 테스트 공백 → feedFilter 저장·복원(옛 lounge 값 폐기 포함), revealEntries,
  parseViewParam(라운지 별칭), 교차 kind 정렬 테스트 보강. App 수준 상호작용 테스트는
  기존 인프라 관례(jsdom 없음)상 백로그 유지.
최종: `npm run check`·`npm test`(29 파일 477 테스트)·`npm run build` 통과.

### 남은 일 (배포 게이트)
1. 커밋·푸시(main 푸시가 CI 배포를 겸한다 — deploy.yml).
2. 프로덕션 마이그레이션: `DATABASE_URL=<prod> npx drizzle-kit migrate` (0011 적용).
   **순서 주의: Worker 배포보다 먼저** — 새 Worker는 posts 테이블이 없으면 pull이 500이다.
3. 실사용 스모크(두 기기 교차: 글+사진 올리기/삭제/댓글/오프라인 큐).
