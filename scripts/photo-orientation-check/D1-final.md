# D1 최종 합의문 — 사진 기능 배포 전 예방 작업

작성일: 2026-08-15 (KST)  
합의 과정: `D1-round1.md` 코드 조사·재현 → 코디네이터 반론/결정 → `D1-round2.md` 구현 스펙·마지막 race 반론 → `cleanup_generation` 포함 최종 합의

## 결론

사진 기능은 그대로 배포하지 않는다. 배포 전에는 아래 여섯 구현 묶음을 순서대로 완료한다.

1. 서버의 영구 사진 삭제 원장, legacy metadata 필터, PUT/cleanup 세대 CAS
2. 클라이언트의 photo ID 단위 3-way 병합
3. IDB 내구성 상태와 photo cache/done blob 수명 정책
4. viewport 기반 로딩과 유한·원인별 재시도
5. Safari 포함 3단 이미지 decode 폴백과 저비용 메모리/투명도 보완
6. viewport gate 위에서 n<=2 full, n>=3 thumb을 쓰는 피드 화질 개선

핵심 정합성 결함은 테스트로 재현됐다. base `[P]`, local `[P,Q]`, server `[]`에서 현재 `mergeEntry`가 `[P,Q]`를 반환한다. `photos` 배열 전체가 local-win 필드이기 때문이다(`src/local/store.ts:142-151,190-223`). 기존 “본문만 동시 수정” 테스트는 local photos가 base와 같아 서버 삭제를 채택하는 경우만 덮는다(`src/local/photoStore.test.ts:275-297`). 임시 회귀 probe는 통과 후 삭제했으며, 최종 구현에서는 정식 테스트로 남긴다.

## 전체 쟁점 분류

| ID | 최종 분류 | 합의 |
|---|---|---|
| A1 400px thumb 화질 | **[배포 전 필수]** | viewport gate 뒤 n<=2 full, n>=3 thumb. medium kind는 후속 |
| A2 피드 pop-in | **[배포 후 개선]** | 고정 높이라 CLS 없음. 일반 fade/선택적 blur-up은 polish |
| A3 404·오류 재시도 | **[배포 전 필수]** | `missing/auth/transient` 분리, 유한 polling, online/visibility/pull rearm |
| A4 토큰 401 | **[배포 후 개선]** | 전역 재로그인은 이미 동작. 업로드 상태별 자동 복구만 후속 |
| B1 제거 photo ID 부활 | **[배포 전 필수]** | 클라이언트 의미 병합 + 서버 영구 원장/필터 + PUT race 방어 |
| B2 상대 기기 photoCache 잔존 | **[배포 전 필수]** | metadata에서 빠진 ID 즉시 purge + LRU |
| B3 삭제 entry를 새 기록으로 살리기 | **[조치 불요]** | 새 UUID+로컬 blob만 복제하며 일시 404는 정상 eventual consistency |
| B4 cleanup 실패 관측 | **[배포 후 개선]** | 현재 로그·재시도는 있음. 필드는 이번 migration, 알람 소비는 후속 |
| C1 구형 Safari EXIF/decode | **[배포 전 필수]** | 지원 하한 상향 대신 3단 폴백과 orientation 검증 |
| C2 HEIC | **[배포 전 필수]** | 이번에는 행동 가능한 오류 문구. HEIC decoder/확대 매트릭스는 후속 |
| C3 IDB 삭제·프라이빗/메모리 모드 | **[배포 전 필수]** | commit 확인, offline 차단, online 경고 허용, persist best effort |
| C4 큰 이미지 메모리 | **[배포 전 필수]** | 파일 간 직렬은 이미 됨. full→thumb encode도 직렬화 |
| C5 다중 탭 큐 | **[배포 후 개선]** | R2 데이터는 멱등. 중복 대역폭/거짓 fail을 lease로 후속 해결 |
| D1 로컬 무제한 보관 | **[배포 전 필수]** | cache cap/LRU, pending 보호, done 보존 기간/압력 정리 |
| D2 R2 비용 | **[조치 불요]** | 5인 사용량은 무료 티어에 수년~수십 년 여유 |
| D3 GET Range/Worker 메모리 | **[조치 불요]** | R2 body를 이미 stream하며 현 클라이언트는 전체 blob 소비 |
| D4 원본 kind 확장 | **[조치 불요]** | suffix 확장 가능. 현재 원본 요구 없고 과거 원본 소급 불가 |
| E1 전체 피드 eager fetch/objectURL | **[배포 전 필수]** | viewport 밖 fetch/timer/objectURL 금지 |
| E2 톰스톤 검사와 PUT의 TOCTOU | **[배포 전 필수]** | B1 서버 원장+post-put rearm+generation CAS에 흡수 |
| E3 투명 PNG 검은 배경 | **[배포 전 필수]** | canvas draw 전 흰색 fill |
| E4 EXIF/GPS | **[조치 불요]** | 원본 미보관+canvas 재인코딩으로 metadata 제거됨 |
| E5 JPEG magic 검증 | **[조치 불요]** | 인증된 5명 경계에서는 후순위 hardening |

## 코드 근거 요약

- 피드 모든 모자이크가 thumb을 요청한다(`src/components/EntryCard.tsx:105-166`). feed는 최대 720 CSS px이고(`src/styles.css:80-83`) 단일 셀은 대략 660~670 CSS px인데 thumb 긴 변은 400px다(`src/lib/image.ts:67-86`). DPR 1에서도 업스케일되고 DPR 2에서는 현저히 부족하다.
- 라이트박스에는 thumb→full blur-up이 있지만(`src/components/PhotoLightbox.tsx:33-47`, `src/styles.css:553-560`) 피드 `PhotoImg`는 placeholder→img 교체뿐이다(`src/components/PhotoImg.tsx:21-28`). 모자이크 높이가 고정이라 레이아웃 이동은 없다(`src/lib/photos.ts:43-50`).
- 404 retry index는 마지막 60초 값에 clamp되어 영구 반복한다(`src/lib/usePhoto.ts:85,119-135`). 반면 network/5xx/401은 모두 `unavailable`이고 재시도 경로가 없다(`src/lib/usePhoto.ts:47-60,137-177`).
- 모든 사진 API는 인증 middleware 아래이고(`worker/index.ts:100-112`), SyncClient는 401을 auth로 올려(`src/local/sync.ts:28-33,95-113`) UI가 토큰 삭제+reload를 제공한다(`src/components/SyncStatus.tsx:1-20`). GET의 전역 재로그인은 안전하지만 XHR 업로드의 401/410/413은 모두 일반 fail이다(`src/local/photoUpload.ts:79-90,297-310`).
- 살아 있는 entry의 trigger는 OLD에만 남은 photo ID만 톰스톤으로 만든다(`migrations/0008_flowery_molecule_man.sql:39-56`). cleanup은 R2 두 key 삭제 뒤 현재 DB row도 삭제한다(`worker/photos.ts:113-144`, `worker/queries.ts:226-240`). 그래서 stale metadata가 부활하면 삭제 기억이 사라져 있다.
- entry 전체 삭제는 별도 삭제 승리 규칙이라 안전하다(`src/local/store.ts:1495-1523`). 문제는 살아 있는 entry 안 photos의 동시 변경이다.
- 내 blob은 entry 참조 제거 때 정리되지만(`src/local/store.ts:888-924`), 상대 사진 cache는 단순 Blob이고 lastAccess/delete/cap이 없다(`src/local/idb.ts:57-60`, `src/local/store.ts:816-843`).
- IDB open 실패/2초 timeout은 조용히 `db=null`이 되고(`src/local/store.ts:459-471`), photo put과 transaction commit 오류도 삼킨다(`src/local/store.ts:649-673,1638-1664`). 정상 저장처럼 보인 뒤 페이지를 닫으면 미업로드 binary만 잃을 수 있다.
- 여러 파일은 이미 한 장씩 직렬 decode한다(`src/lib/photoDraft.ts:22-41`). 한 사진의 full/thumb canvas만 동시에 encode한다(`src/lib/image.ts:79-86`); bitmap은 finally에서 닫는다(`src/lib/image.ts:89`).
- Feed는 pagination/windowing 없이 전체 기록을 마운트한다(`src/components/Feed.tsx:27-60`). 각 `PhotoImg` hook은 mount 즉시 fetch/cache/objectURL을 시작한다(`src/components/PhotoImg.tsx:21-28`, `src/lib/usePhoto.ts:100-169`).
- GET은 R2 `object.body`를 그대로 Response에 전달한다(`worker/index.ts:159-180`). Worker 전체 buffering 문제는 없다.

## §1. 서버 데이터 — 영구 삭제 원장과 경쟁 방어

우선순위: 가장 먼저 배포. 새 클라이언트보다 서버가 구번들까지 먼저 방어해야 한다.  
예상 규모: 구현 150~240 LOC + 테스트 110~180 LOC. Drizzle 생성 snapshot의 기계적 diff는 제외한다.

### 스키마와 trigger

`photo_tombstones`에 다음을 추가한다(`worker/schema.ts:40-45`).

- `cleaned_at timestamptz null`
- `attempt_count integer not null default 0`
- `last_error text null`
- `first_failed_at timestamptz null`
- `cleanup_generation integer not null default 0`

행은 R2 삭제 성공 뒤에도 지우지 않는다. 한 photo ID의 “한 번 삭제됨”을 영구 기억한다. 예상 최대 수만 행은 현재 규모에서 부담이 작다.

새 `BEFORE INSERT OR UPDATE ON entries` trigger는 `NEW.photos` 중 원장에 존재하는 ID를 제거한다. API 행 단위 reject는 CAS/배치 의미를 복잡하게 하므로 쓰지 않는다. DB 경계 필터는 v 없는 legacy LWW 경로(`worker/index.ts:301-312`)에도 동일하게 적용된다. 기존 AFTER trigger는 OLD에서 실제 빠진 새 ID를 pending 원장에 넣는다(`migrations/0008_flowery_molecule_man.sql:39-64`).

### cleanup 세대 CAS

pending query는 `cleaned_at IS NULL`인 `(photo_id, cleanup_generation)`을 오래된 순서로 읽는다. R2 delete 성공 뒤에는 다음 조건으로만 완료 표시한다.

```sql
UPDATE photo_tombstones
SET cleaned_at = now(), last_error = NULL
WHERE photo_id = $id
  AND cleanup_generation = $observed_generation;
```

R2 실패는 row를 pending으로 유지하고 `attempt_count += 1`, `last_error`, 최초 실패 때만 `first_failed_at`을 기록한다. 현재 구조화 로그와 매시 재시도는 유지한다(`worker/photos.ts:113-144`, `worker/notify.ts:299-316`).

### PUT 사전·사후 장벽

PUT은 현재처럼 body를 읽기 전 원장 존재를 검사해 410을 반환한다(`worker/index.ts:120-142`). R2 put 성공 뒤 원장을 다시 조회한다. 그 사이 tombstone이 생겼다면:

1. `cleanup_generation += 1`, `cleaned_at=NULL`로 원장을 재무장한다.
2. 방금 쓴 kind의 R2 key를 즉시 delete한다.
3. 즉시 delete 성공 여부와 무관하게 새 generation row는 cron이 두 kind를 다시 확인·삭제하고 정산하게 둔다.
4. 클라이언트에는 410을 반환한다.

generation이 필요한 이유는 cleanup이 delete를 끝내고 완료 UPDATE 직전일 때 post-put 재무장이 끼어도, stale cleanup이 새 pending을 완료 처리하지 못하게 하기 위해서다. 이 마지막 반론을 코디네이터가 명시적으로 채택했다.

### 수용 기준

- `worker/sync.test.ts`: `cleaned tombstone id는 CAS push photos에서 제거하고 독립 신규 id는 보존한다`.
- `worker/sync.test.ts`: `cleaned tombstone id는 legacy LWW push에서도 부활하지 않는다`.
- `worker/notify.test.ts`: `cleanup 성공은 원장 row를 남겨 cleaned_at만 찍고 pending에서 제외한다`.
- `worker/notify.test.ts`: `R2 실패는 attempt_count/last_error/first_failed_at을 기록하고 다음 cron에서 재시도한다`.
- `worker/index.test.ts`: `사전 검사 뒤 생긴 tombstone은 post-put에서 rearm하고 객체를 지운 뒤 410을 반환한다`.
- barrier test: `cleanup gen0 delete와 늦은 PUT gen1 rearm이 교차하면 gen0 완료 CAS가 실패하고, 최종 R2 두 key가 없으며 gen1만 정산된다`.

## §2. 클라이언트 데이터 — photo ID 의미 병합

배포 순서: §1 서버 이후. 구현 자체는 병행 가능.  
예상 규모: 구현 35~60 LOC + 테스트 60~110 LOC.

`photos`를 일반 `pick()`에서 제외한다(`src/local/store.ts:190-223`). 다음 규칙으로 ID 단위 병합한다.

- base에 있던 ID: local과 server 양쪽이 모두 유지할 때만 생존한다. 한쪽 제거는 삭제 승리다.
- base에 없던 local/server 신규 ID: 각 배열의 상대 순서를 보존하는 stable union으로 합친다.
- ID 중복을 제거하고 기존 `normalizePhotos`의 4장 제한을 마지막에 적용한다.
- 최종 배열에서 빠진 내 blob은 기존 `reconcileEntryPhotoReferences`가 지운다(`src/local/store.ts:888-924`).

수용 기준:

- `src/local/merge.test.ts`: `base 사진은 한쪽에서 제거하면 삭제 승리한다`.
- `src/local/merge.test.ts`: `양쪽 독립 신규 사진은 stable union하고 중복 없이 4장으로 제한한다`.
- `src/local/photoStore.test.ts`: `server가 P를 지우고 local이 Q를 추가한 충돌은 Q만 재전송하고 P blob을 정리한다`.

## §3. 클라이언트 데이터 — IDB 내구성과 저장 공간

배포 순서: §1/§2와 독립 구현 가능. cache schema와 상태를 한 IDB version bump로 처리한다.  
예상 규모: 구현 190~300 LOC + 테스트 130~200 LOC.

### photoCache

`photoCache` value를 `{ blob, bytes, lastAccess }`로 바꾼다(`src/local/idb.ts:57-60`). disposable cache이므로 v5의 bare Blob store는 upgrade에서 안전하게 비우고 재생성해 복잡한 binary migration을 피한다. `photoBlobs`는 절대 비우지 않는다.

- cache cap: `min(150MB, navigator.storage.estimate().quota * 0.2)`. estimate 미지원/값 없음은 150MB.
- cap 초과 시 `lastAccess`가 오래된 순으로 75% 목표치까지 삭제.
- access 시각은 매 read마다 IDB/BroadcastChannel write하지 않고 메모리에서 갱신해 debounce/batch flush.
- 원격 metadata에서 빠진 photo ID는 full/thumb cache key를 즉시 purge(`src/local/store.ts:888-924`에 연결).
- 내 `wait/up/fail` blob은 어떤 LRU에도 포함하지 않는다.
- 내 `done` blob은 14일 동안 유지하고, 이후 또는 저장 압력에서 오래된 것부터 삭제해 R2 refetch에 맡긴다. “새 기록으로 살리기”의 즉시 복제는 이 보존 창 안의 local blob에 한정된다(`src/local/store.ts:793-813`).

### durable storage 상태와 사진 attach

store snapshot에 최소 `durableStorage: ready | unavailable | quota-error`와 `storagePersistence: persistent | best-effort | unknown`을 노출한다.

- DB가 정상인 경로: `photoBlobs.put` transaction commit을 await한 뒤에만 `EntryPhoto`를 반환해 시트에 붙인다(`src/local/store.ts:621-673`, `src/App.tsx:432-462`). 실패하면 메모리 row/reservation을 rollback하고 상태를 올린다.
- DB가 없거나 commit 실패로 unavailable인 명시적 예외: offline이면 사진 추가를 막고 안전하게 보관할 수 없다고 안내한다. online이면 메모리 row/즉시 업로드를 허용하되 시트에 “업로드가 끝날 때까지 페이지를 닫지 마세요” 경고를 유지한다.
- user gesture 뒤 `navigator.storage.persist()`를 best-effort로 요청한다. false/미지원은 오류가 아니다. `estimate()`는 LRU 판단에 사용한다.
- `QuotaExceededError`가 나면 downloaded cache를 먼저 비운다. pending blob write가 그래도 실패하면 무시하지 않고 위 위험 상태/UI로 올린다.
- 현재 2초 open race의 losing promise가 나중에 연 연결도 닫도록 해 보이지 않는 IDB handle을 남기지 않는다(`src/local/idb.ts:69-117`, `src/local/store.ts:459-471`).

WebKit은 IndexedDB를 포함한 script-writable storage가 Safari에서 사용자 상호작용 없이 Safari를 7일 사용하면 제거될 수 있다고 설명한다: <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/#7-day-cap-on-all-script-writeable-storage>. Home Screen 앱은 별도 사용 counter라 정상 사용 시 제외된다. Safari 17+의 persist 요청은 지원되지만 Home Screen 여부 같은 heuristic으로 허용되므로 보장이 아니다: <https://webkit.org/blog/14403/updates-to-storage-policy/#storage-api>.

수용 기준:

- `src/local/photoStore.test.ts`: `정상 DB에서는 photoBlobs commit 전 metadata를 반환하지 않는다`.
- `photoBlobs commit 실패는 메모리 row를 rollback하고 상태를 quota-error/unavailable로 올린다`.
- `IDB unavailable+offline은 추가를 거부하고 online은 memory-risk로 허용한다`.
- `QuotaExceeded는 pending을 보존하고 downloaded cache만 75%까지 LRU 삭제한다`.
- `원격 photos 제거는 full/thumb cache를 즉시 purge한다`.
- `done은 14일 전 보존, 이후 압력에서 제거하고 wait/up/fail은 보존한다`.
- IDB upgrade test: `v5 photoCache는 버리고 photoBlobs는 그대로 유지한다`.
- UI test: offline 차단과 online 페이지 유지 경고가 각 상태에서 보인다.

## §4. 클라이언트 네트워크 — viewport와 재시도 상태 머신

배포 순서: §6 고해상도 전환보다 먼저.  
예상 규모: 구현 130~220 LOC + 테스트 100~170 LOC.

`PhotoImg` 또는 hook 앞에 IntersectionObserver gate를 두고 viewport 인접 400~800px `rootMargin`에 들어오기 전에는 fetch, retry timer, objectURL을 만들지 않는다(`src/components/PhotoImg.tsx:21-28`, `src/lib/usePhoto.ts:100-179`). 라이트박스/시트의 현재 사진은 즉시 활성화한다. Observer 미지원은 기능 보존을 위해 즉시 로드한다.

GET 결과를 다음처럼 나눈다.

- `found`: 표시/cache.
- `missing`(404): 5s→15s→60s, 총 약 15분 이내까지만 polling. 이후 멈춘다.
- `auth`(401): 사진별 polling 금지, 기존 전역 Sync auth UI에 맡긴다.
- `transient`(network, 408/429/5xx): bounded exponential backoff. online/visibility에서 즉시 재시도.

missing budget은 visibility/online뿐 아니라 새 pull generation에서 재무장한다. 영구 깨진 metadata가 매분 평생 GET을 만들지 않으면서, 오래 offline이던 상대 업로드가 새 동기화 뒤 나타날 수 있게 한다. 동일 photo/kind의 in-flight request뿐 아니라 retry owner도 공유해 한 화면의 중복 timer를 막는다(`src/lib/usePhoto.ts:24,43-65`).

수용 기준(새 `src/lib/usePhoto.test.ts` 권장):

- `viewport 밖에서는 cache/network/timer/objectURL을 시작하지 않는다`.
- `network failure 뒤 online은 같은 mount에서 즉시 다시 읽는다`.
- `404는 5/15/60초 후 15분 budget에서 멈추고 pull/visibility/online이 재무장한다`.
- `401은 retry loop 없이 auth로 분류한다`.
- `같은 photo/kind 두 소비자는 in-flight와 retry timer를 공유한다`.
- `unmount는 observer/timer/objectURL을 모두 정리한다`.

## §5. 클라이언트 이미지 파이프라인 — 호환성과 작은 라이더

배포 순서: 다른 client data 작업과 독립.  
예상 규모: 구현 70~120 LOC + 테스트 60~110 LOC.

decode는 다음 순서다(`src/lib/image.ts:71-90`).

1. `createImageBitmap(file, { imageOrientation: 'from-image' })`
2. 실패 시 `createImageBitmap(file)`
3. 실패 시 object URL + `<img>.decode()/onload` + canvas

현행 HTML Standard의 optionless 기본은 `from-image`다: <https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmapoptions-imageorientation>. WebKit은 Safari 17.2에서 이전의 자동 orientation keyword `none`을 기능 변화 없이 `from-image`로 바꿨다: <https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#image-orientation>. 그러므로 새 enum을 거부하는 구 WebKit은 optionless 당시 기본 동작으로 회복하고, API/format decode까지 실패하면 `<img>`가 마지막 폴백이다.

각 단계의 bitmap/object URL은 성공·실패 모두 finally에서 정확히 해제한다. full JPEG encode가 끝난 뒤 thumb를 encode해 두 canvas peak가 겹치지 않게 한다(`src/lib/image.ts:79-89`). draw 전 canvas를 흰색으로 채워 투명 PNG/WEBP가 JPEG의 transparent black으로 합성되지 않게 한다(`src/lib/image.ts:51-64`). decode 오류 문구는 “JPG/PNG로 변환하거나 사진 앱에서 공유해 주세요”처럼 행동을 알려 준다(`src/lib/constants.ts:170-173`).

수용 기준:

- `src/lib/image.test.ts`: `from-image 실패→optionless 실패→img 순서로 fallback한다`.
- `각 fallback resource를 성공/실패 모두 한 번만 해제한다`.
- `full encode 완료 뒤 thumb encode를 시작한다`.
- `drawImage 전에 white fill을 한다`.
- 실제 Safari 16/17.1 가능 환경과 현재 Safari/Chrome에서 EXIF orientation 1/6/8 fixture가 같은 정방향으로 출력된다. Node mock만으로 실제 방향을 검증했다고 간주하지 않는다.

## §6. 클라이언트 UI — 피드 해상도 선택

배포 순서: §4 viewport gate 이후.  
예상 규모: 구현 10~35 LOC + 테스트 20~45 LOC.

- 넓은 feed의 1~2장 layout은 full, 3~4장은 thumb을 요청한다(`src/components/EntryCard.tsx:105-166`, `src/lib/photos.ts:43-50`).
- compact calendar preview와 edit sheet tile은 thumb 유지(`src/components/EntryCard.tsx:168-179`, `src/components/EntryModal.tsx:293-300`).
- cached thumb→full blur-up은 기존 lightbox 패턴을 단순 재사용할 수 있을 때만 추가한다. 별도 복잡한 상태 머신은 만들지 않고 필수 수용 기준에도 넣지 않는다.
- medium 800~1000px kind는 R2 key/parser/upload/cleanup 전체를 넓히므로 후속으로 둔다(`worker/photos.ts:8-25,124-130`).

수용 기준:

- `n=1/2 wide feed는 full, n=3/4와 compact/sheet는 thumb을 선택한다`.
- §4 통합 test에서 viewport 밖 n=1 카드가 full GET을 만들지 않는다.

## §7. 전체 검증과 배포 게이트

자동 검증:

- `npm run check`
- `npm test`
- 새 migration을 빈 DB와 0008 적용 DB 모두에 적용하는 테스트
- barrier를 쓴 cleanup/PUT race test를 반복 실행해 결정적 통과

수동 시나리오:

1. Chrome: offline 사진 저장→online 자동 upload→다른 세션 표시, cold/warm cache, 1~4장 feed.
2. 동시성: A가 P 제거, B가 Q 추가한 뒤 sync해 최종 metadata `[Q]`, P R2 두 key 없음, 원장 P 유지/cleaned.
3. Safari: EXIF 1/6/8, Files에서 선택한 미지원 HEIC 안내, private browsing online warning/offline block.
4. 저장 압력: cache cap 초과 때 downloaded/done만 LRU되고 wait/up/fail은 유지.
5. 두 탭: 중복 PUT 가능성은 known limitation으로 기록하되 최종 R2/metadata가 일치하는지 smoke.

배포 준비 완료 조건은 위 자동 검증 전부 통과, 수동 1~4 통과, R2 bucket/binding 존재 확인이다. 읽기 전용 `npx wrangler r2 bucket list` 결과 `learning-crew-photos`가 2026-08-15 생성된 상태였고 binding은 `wrangler.jsonc:17-19`와 일치한다. 배포 명령은 이 토론에서 실행하지 않았다.

## 배포 후 개선 백로그

1. **[배포 후 개선] 다중 탭 uploader leader** — Web Locks, 미지원 시 IDB lease. 현재 탭별 queue만 dedupe한다(`src/local/photoUpload.ts:104-115,214-237`); R2 same-owner put은 멱등이라 데이터보다 대역폭/거짓 fail 문제다(`worker/photos.ts:73-105`).
2. **[배포 후 개선] HTTP 상태별 upload UX** — 401은 재로그인 뒤 자동 재개, 410은 삭제됨, 413은 크기 재인코드/명확 안내. 현재 모두 일반 fail이다(`src/local/photoUpload.ts:79-90,297-310`).
3. **[배포 후 개선] 운영 alert 소비** — 이번 migration의 attempt/error/age를 로그/지표에서 읽어 oldest pending age와 연속 실패를 알린다. 현재 구조화 로그와 hourly retry는 이미 있다(`worker/photos.ts:131-141`, `worker/notify.ts:307-316`).
4. **[배포 후 개선] 피드 polish/장기 scale** — fade-in, 선택적 blur-up, pagination/windowing, medium kind를 실제 사진 수와 측정치에 따라 추가.
5. **[배포 후 개선] 기기 매트릭스** — 실제 HEIC 성공률, 12/48MP peak, 구형 Android/Safari를 측정해 필요할 때 worker resize/WASM decoder를 검토.

## 조치 불요 근거와 비용 수치

- 새 기록 살리기는 삭제 ID를 재사용하지 않고 local full+thumb이 남은 사진만 새 UUID로 복제한다(`src/local/store.ts:793-813`; 테스트 `src/local/photoStore.test.ts:233-273`). metadata와 binary가 병렬이라 다른 기기의 잠깐 404는 정상이다(`src/local/store.ts:945-966`).
- 원본은 저장하지 않고 canvas JPEG만 반환한다(`src/lib/image.ts:51-70`). EXIF/GPS는 복사되지 않는다.
- R2 공식 Standard 무료분은 10GB-month, 월 Class A 100만, B 1,000만, egress 무료다: <https://developers.cloudflare.com/r2/pricing/>. 사진당 280~450KB면 약 22,200~35,700장이다. 5명×1장/일은 10GB까지 약 12.3~19.8년, 매일 최대 4장은 약 3.1~5.0년이다. 각 사진 두 variant의 정상 PUT/HEAD도 월 최대 약 1,200회씩이라 operation 한도와 거리가 크다.
- GET은 `object.body` stream이고 full 상한도 2.5MB다(`worker/index.ts:159-180`, `worker/photos.ts:8-13`). 현재 client가 `response.blob()` 전체를 소비하므로 Range 구현은 실익이 없다(`src/lib/usePhoto.ts:47-57`).
- key는 `p/<uuid>`와 `.t`로 중앙화돼 future suffix 확장이 가능하다(`worker/photos.ts:8-25`). 단 cleanup key 목록도 함께 넓혀야 한다(`worker/photos.ts:124-130`), 과거 원본은 복구할 수 없다.

## 예상 작업량과 파트 분할

| 파트 | 구현+테스트 예상 | 병행 가능성 |
|---|---:|---|
| 서버 원장/trigger/PUT generation | 260~420 LOC | 먼저 배포, 독립 구현 가능 |
| 클라이언트 photo 의미 병합 | 95~170 LOC | 서버와 병행, 배포는 서버 뒤 |
| IDB 내구성/cache LRU/UI 상태 | 320~500 LOC | 한 IDB upgrade owner가 담당 |
| viewport/retry state machine | 230~390 LOC | IDB API 합의 뒤 대부분 병행 |
| 이미지 decode/encode pipeline | 130~230 LOC | 독립 |
| 피드 kind 선택 | 30~80 LOC | viewport 완료 뒤 |

수치는 테스트를 포함한 추정이며 생성 migration snapshot과 formatting diff는 제외한다. 구현 작업은 서버, 클라이언트 데이터, 클라이언트 로딩/UI의 세 파트로 나누되, 공유 타입·IDB version·`usePhoto` ownership 충돌을 피하려고 각 파일 owner를 한 명으로 둔다.

이 문서는 다음 구현 태스크의 승인된 스펙이다. 이 토론에서는 코드 커밋이나 배포를 하지 않았다.
