# 개인 커스텀 태그 — 설계 (v1)

리포: /home/hwankr/projects/learningCrew (현재 워크트리, main 브랜치, 베이스 커밋 a227944)
검증 명령: `npm run check` (타입체크 3종) · `npm test` (vitest)

## 요구사항

1. 멤버 각자가 "무엇을 했나요" 태그를 직접 추가할 수 있다.
2. 내가 추가한 태그는 **내 기록하기 시트에만** 선택지로 뜬다 (다른 멤버의 피커를 어지럽히지 않는다).
3. 커스텀 태그가 많아졌을 때 피커가 무너지지 않아야 한다 (접기/펼치기 등 오버플로 처리).
4. 커스텀 태그 **삭제** 가능. 삭제해도 과거 기록에 붙은 태그는 그대로 남는다 (선택지에서만 빠진다).
5. 저장된 기록의 커스텀 태그는 크루 전원의 피드·보드·달력에 그대로 보인다 (기본 색 폴백).

## 아키텍처 결정

### A. 태그 값 모델 — 닫힌 union을 연다

- `shared/types.ts`의 `TAGS`(5개)는 **기본 제공 태그**로 이름 그대로 유지. `KnownTag = (typeof TAGS)[number]` 별칭 추가.
- `Tag` 타입은 `string`으로 완화. 검증은 전부 `normalizeTags` 경계가 맡는다 (기존 철학 유지: 모든 경계에서 같은 정규화).
- `TAGMETA`는 `Record<KnownTag, …>`로 좁히고, 커스텀 태그는 조회 헬퍼(`tagMeta(tag)`)가 중립 폴백을 돌려준다.

### B. `normalizeTags` 확장 — 결정성이 생명

기존 주석의 경고 그대로: **순서가 흔들리면 내용이 같은 기록이 서로를 "변경"으로 보고 헛 동기화가 돈다.**
서버(Worker)와 클라이언트가 같은 함수를 쓰므로 환경 의존적 정렬(localeCompare) 금지.

새 의미론:
1. 입력 각 항목에 `sanitizeCustomTag` 적용: `trim` → NFC 정규화 → 내부 연속 공백 1칸으로 축약. 결과가 빈 문자열, 제어문자 포함, 코드포인트 기준 12자 초과면 버린다.
2. 기본 태그(TAGS에 있는 값)는 **TAGS 순서** 그대로 앞에.
3. 커스텀 태그는 중복 제거 후 **코드포인트 비교(`<`) 정렬**로 뒤에 붙인다.
4. `'OFF'` 배타 규칙 유지: OFF가 섞이면 `['OFF']`만 남는다.
5. 총 개수는 `TAG_LIMITS.perEntry = 8`개로 자른다 (위 순서로 앞에서부터).

`entryTags`·`primaryTag` 의미는 그대로. `tag`(deprecated) 컬럼은 text라 커스텀 문자열도 문제없이 담긴다. 서비스워커 캐시에 남은 구버전 번들은 커스텀 태그를 '기타'로 강등해 보게 되는데, 이는 수용한다 (기존 이행기 규약과 동일한 열화 방식).

새 상수:
```ts
export const TAG_LIMITS = {
  nameLen: 12,   // 코드포인트 기준
  perEntry: 8,   // 기록당 태그 수 (기본+커스텀 합)
  perMember: 20, // 멤버당 커스텀 태그 수
} as const;
```

### C. 멤버별 커스텀 태그 목록 — `NotifPrefs`/`MemberStatus` 패턴 재사용

파생(과거 기록에서 추출) 방식은 기각: 삭제를 표현하려면 음수 목록이 따로 필요해져 더 복잡해진다. 명시적 목록 + LWW가 단순하다.

- 타입:
  ```ts
  export interface TagPrefs {
    m: MemberId;
    tags: string[];    // sanitize + 코드포인트 정렬, 중복 없음, 기본 태그와 겹치지 않음, 최대 20
    updatedAt: string; // 액션 시각 — MemberStatus처럼 도착 순서가 아니라 이 시각으로 LWW
  }
  export function normalizeCustomTagList(list: unknown): string[]  // 위 규칙의 단일 정의
  ```
- DB: `tag_prefs` 테이블 — `member_id text PK`, `tags jsonb NOT NULL DEFAULT []`, `updated_at timestamptz NOT NULL`. drizzle 마이그레이션(`npm run db:generate`) 추가.
- API (기존 `/api/notify/prefs` 라우팅·인증 관용구를 그대로 따른다):
  - `GET /api/tags/prefs` → `{ ok: true, prefs: TagPrefs }` (행이 없으면 빈 목록 기본값)
  - `PUT /api/tags/prefs` body `{ tags: string[], at: string }` → `{ ok: true, prefs: TagPrefs, applied: boolean }`
    서버는 `normalizeCustomTagList`로 재검증하고, `at`이 기존 행 `updatedAt`보다 새로울 때만 적용(LWW), 미래 시각은 서버 시계로 캡(MemberStatus의 기존 관용구).
- 삭제 = 목록에서 빼고 PUT. 과거 기록은 건드리지 않는다.

### D. 클라이언트 데이터 계층

- `src/local/store.ts`에 TagPrefs 로컬 캐시 추가 (기존 IDB + 메모리 폴백 관용구 따름).
- App 부팅 시 캐시를 즉시 반영하고, 온라인이면 GET으로 최신화. 변경(추가/삭제) 시 로컬 먼저 반영 + PUT. 오프라인이면 로컬만 갱신하고 재접속 시 PUT 재시도 (기존 useOnline/동기화 루프 관용구). LWW라 어느 기기가 이겨도 수렴한다.
- `EntryModal`에는 props로 내려준다: `customTags: string[]`, `onAddCustomTag(name): string | null`(실패 사유 문구 반환), `onRemoveCustomTag(name)`.

### E. 피커 UI (기록하기 시트) — 디자인 재량 영역

필수 동작(아래는 계약, 시각 디테일은 디자이너 재량):
- 칩 목록 = 기본 5개(OFF 포함) + 내 커스텀 태그 + `+ 추가` 칩.
- **오버플로**: 전체가 대략 2줄을 넘으면 접고 "+n" 펼치기 칩(기존 `MoreChip` 관용구)으로 확장. 단, **선택된 태그는 접힌 상태에서도 항상 보인다**. 펼침 상태는 시트 세션 내 유지.
- **추가**: `+ 추가` 칩 → 인라인 입력(maxLength 12) → Enter/확정. 검증 실패(중복·기본 태그와 동일·길이·개수 초과)는 인라인 문구로. 성공 시 즉시 선택 상태로.
- **삭제**: "편집" 토글 → 커스텀 칩에만 × 배지 → 탭하면 목록에서 제거. 기본 태그·OFF는 삭제 불가. "과거 기록에는 남아요" 안내 한 줄.
- 접근성: 기존 `role="group"`/`aria-pressed` 패턴 유지, 입력에 라벨.

### F. 표시 폴백 (피드·보드·달력)

- `Chip.tsx`: `TAGMETA`에 없는 태그면 중립 색(`기타` 계열 무채색) + 범용 태그 아이콘으로 렌더. (선택: 이름 해시로 파스텔 팔레트를 결정적으로 배정해도 좋다 — 라이트 테마와 조화되면 디자이너 재량.)
- `worker/notify.ts`의 푸시 문구 `tags.join('·')`은 앞 3개까지만 나열하고 넘치면 `외 n`을 붙인다 (커스텀 태그로 문구가 길어지는 것 방어).

## 세션 분할

| 세션 | 담당 | 내용 |
|---|---|---|
| S1 | codex | shared 타입·정규화 + 서버(테이블·마이그레이션·API·경계) + 테스트 |
| S2 | codex | 클라이언트 데이터 계층(store 캐시·App 연결·오프라인) + 테스트 |
| S3 | claude opus | 피커 UI(추가·삭제·오버플로) + 표시 폴백 + 스타일 |

각 세션 종료 후 codex 리뷰 세션이 그 세션의 diff를 검토하고, 발견 사항은 해당 세션 워커가 수정한다.

## 리뷰 관점 (모든 리뷰 세션 공통)

- 정규화의 결정성: 클라·서버가 같은 입력에 같은 출력(순서 포함)을 내는가. localeCompare/환경 의존 정렬이 섞이지 않았는가.
- 경계 완전성: push/pull/IDB 복원/초안 복원/서버 재검증 모든 경로가 새 normalize를 지나는가.
- 헛 동기화: 같은 내용이 왕복 후 "변경"으로 재판정되는 경로가 없는가.
- 한도 방어: nameLen/perEntry/perMember가 클라·서버 양쪽에서 강제되는가.
- 기존 테스트 관용구를 따르는 테스트가 추가됐는가. `npm run check`와 `npm test`가 깨끗한가.
