# 개인 커스텀 태그 — 세션·리뷰 기록 (2026-08-15)

DESIGN.md의 설계를 orca 오케스트레이션 3세션으로 구현했다. 구현·수정마다 codex 읽기 전용
리뷰가 diff 전체와 `npm run check`·`npm test`를 직접 확인했다. 커밋 시점 기준 26파일
427개 테스트 전부 통과.

## 세션

| 세션 | 담당 | 내용 |
|---|---|---|
| S1 | codex | 열린 Tag 모델(`KnownTag`/`TAG_LIMITS`/`sanitizeCustomTag`), `normalizeTags` 결정적 확장, `tag_prefs` 테이블·0010 마이그레이션·GET/PUT `/api/tags/prefs`(strict LWW·미래 시각 캡), 알림 문구 앞 3개+외 n |
| S2 | codex | TagPrefs IDB 캐시+메모리 폴백+dirty 재전송, SyncClient GET/PUT LWW 병합, App→EntryModal props 계약(`customTags`/`onAddCustomTag`/`onRemoveCustomTag`) |
| S3 | claude opus | 피커 재구성(인라인 추가·편집 모드 × 배지·접기/펼치기), `tagMeta()` FNV-1a 해시 6색 파스텔 폴백(대비 ≥5.3:1), 유령 태그(목록에서 지웠지만 기록에 남은 태그) 선택 유지 |

## 리뷰 발견과 수정

- **S1 리뷰**: lone UTF-16 surrogate가 `sanitizeCustomTag`를 통과해 jsonb 진입 시 요청·배치가
  500으로 죽는 문제(PGlite 재현) → `isWellFormed` 기능 감지 + 정규식 폴백으로 거부.
- **S2 리뷰**: 발견 없음.
- **S3 리뷰**: ① perEntry 8개 상태의 9번째 선택/추가가 정렬-후-절단으로 조용히 무시되거나
  기존 선택을 밀어냄 → `hasTagRoom`으로 세 입구 통일 + "태그는 8개까지예요" 안내,
  ② 접기 기준이 개수뿐이라 긴 이름 조합에서 안 접힘 → 어림 폭 + 탐욕 줄바꿈,
  ③ 입력 maxLength가 UTF-16 단위라 이모지 태그 차단 → 24로 완화(검증은 공용 함수로 일원화).
- **최종 검증(수정분 재리뷰)**: ① 접기 폭이 350px 고정이라 320px 컨테이너에서 3줄인데 안
  접힘 → 컨테이너 실측(chipsRef+ResizeObserver)으로 교체, ② `+ 추가` 열기가 `tagFull`
  판정이라 8개 찬 기록의 유령 태그 재등록 입구가 막힘 → `canOpenTagAdd`로 허용.
- **2차 수정 검증**: 발견 없음 — 실측 전 첫 렌더는 paint 전 교정, observer 해제 누수 없음,
  360px/408px 헤드리스 Chrome 실측으로 접힘 판정 대조.

S3의 UI 검증 상세(헤드리스 Chrome 실측 수치)는 S3-report.md, S3-fix-report.md,
S3-fix2-report.md 참고.

## 운영 메모

- `migrations/0010_fresh_titania.sql`(tag_prefs)은 2026-08-15 `drizzle-kit migrate`로 프로덕션
  Neon(neondb)에 적용 완료 (원장 11건).
- 서비스워커 캐시에 남은 구버전 번들은 커스텀 태그를 '기타'로 강등해 본다 — 의도된 열화.
