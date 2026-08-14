# 러닝 크루 👟 (learning-crew)

5인 스터디 크루(승환·웅·태현·진주·경진)가 하루 공부 기록을 남기고 서로의 기록을 보는 앱.
"러닝"은 running이 아니라 **learning** — 공부 크루다. 한 줄 메모 + 일기/할 일 목록,
태그(자격증/영어/코딩테스트/기타/OFF), 별점, 피드·캘린더,
지금 상태 체크인(장소 칩을 탭하면 "도서관에서 공부 중 · n분째"가 크루 보드에 표시),
공부 시작 웹 푸시 알림(체크인이 off→on으로 바뀌면 나머지 크루 기기로 알림),
서로의 기록에 남기는 이모지 리액션과 댓글.

**운영 URL**: https://learning-crew.learning-crew.workers.dev
**로그인**: 첫 방문에 이름(아바타)을 고르면 끝 — 서버가 해당 멤버의 서명 토큰을 발급해 기기에 저장한다.
신원 검증은 없다(URL을 아는 사람 = 크루 전제). 링크가 새면 `AUTH_SECRET` 교체로 전원 로그아웃.

[Claude Design 프로토타입](https://claude.ai/design/p/601a88c4-4037-44d9-9b91-4f8b386af907)에서 출발 — 초기 정적 구현은 [legacy/](legacy/)에 보존.

## 아키텍처 — 로컬 퍼스트

```
[브라우저]  React SPA + IndexedDB 복제본 + 뮤테이션 큐   ← UI는 로컬만 읽고 쓴다 (0ms, 오프라인 동작)
    │  POST /api/sync/push   (백그라운드, 기록·댓글·리액션 세 스트림을 한 요청에 함께
    │                         기록은 버전 CAS 업서트 — 충돌 시 서버 행을 받아 3-way 병합)
    │  GET  /api/sync/pull   (스트림별 독립 키셋 커서 + 90초 안전 지평선, 탭 보일 때만 20초 폴링
    │                         since·sinceId / csince·csinceId / rsince·rsinceEntry·rsinceM)
    │  POST /api/sync/status (지금 상태 — 액션 시각 기준 LWW, pull 응답에 전 멤버 상태 동봉)
    │  POST /api/push/subscribe·unsubscribe (웹 푸시 구독 — 기기당 1행)
[Cloudflare Worker]  인증(HMAC 초대 토큰) + 동기화 API + SPA 정적 서빙
    │                상태 off→on 전환 시 VAPID 웹 푸시 발송 (waitUntil 백그라운드, 30분 쿨다운을
    │                조건부 UPDATE로 원자 선점 — 중복 발송 없음, 404/410 구독 자동 정리)
    │  @neondatabase/serverless (HTTP)
[Neon Postgres]  진실의 원천. entries 테이블(version = push CAS 기준), soft delete
                 status 테이블(멤버당 1행) — 지금 상태(장소/시작 시각/알림 도장)
                 comments 테이블 — 기록에 달린 댓글, 내용 불변 + soft delete
                 reactions 테이블 — (기록, 멤버)당 1행: 그 멤버가 남긴 이모지 집합
                 push_subs 테이블 — 웹 푸시 구독 (endpoint가 기기 식별자)
```

- 스택: React 19 + TypeScript + Vite / Hono / Drizzle ORM / PGlite(테스트)
- 수정 충돌: push는 base 버전 CAS — 충돌하면 서버 현재 행을 받아 **필드 단위 3-way 병합**
  (다른 필드끼리는 양쪽 다 살고, 같은 필드는 로컬 승리, 삭제는 항상 승리 — 부활 없음).
  전송 중 재수정은 rev 카운터로 감지해 큐에 남긴다 — ACK가 최신 수정을 지우지 못한다
- 삭제는 `deleted_at` soft delete로 전파. pull 커서는 "지금-90초" 안전 지평선까지만 전진해
  트랜잭션 커밋 지연으로 과거 시각에 나타나는 행도 놓치지 않는다 (중복은 v 비교로 무시)
- 서버는 "기존 행이 본인 것일 때만" 갱신을 허용 (`setWhere` 가드) — 남의 기록을 덮을 수 없다
- 댓글은 **내용 불변**(수정 없음) — 서버는 본문과 작성 시각을 절대 덮어쓰지 않고 `deleted_at`만
  단조로 찍는다. 그래서 재전송이 그냥 멱등이고, 남의 댓글은 삭제할 수 없으며(`member_id` 가드),
  한 번 지운 댓글은 부활하지 않는다. `comments`/`reactions`에는 `entries` 외래키를 **걸지 않는다** —
  아직 push되지 않은 내 기록에도 바로 댓글을 달 수 있어야 하고, FK 위반 하나가 배치 전체를 죽이면 안 된다
- 리액션은 (기록, 멤버)당 1행 = 그 멤버가 그 기록에 남긴 **이모지 집합**(👏 🔥 💪 👀 😴 5종 고정).
  지금 상태와 같은 의미론으로 도착 순서가 아니라 **액션 시각(`acted_at`) LWW** — PK에 `member_id`가
  있어 남의 행과는 충돌 자체가 없다. 다 떼면 행은 남기고 빈 집합으로 둔다("다 뗐다"도 전파해야 한다)
- `acted_at`(액션 시각)과 `updated_at`(서버 시계)을 나눈 이유: 승패 판정은 사용자가 누른 시각으로 해야
  오프라인 기기의 옛 토글이 최신을 덮지 않고, pull 커서는 서버 시계로 단조 증가해야 페이지네이션이
  뒤로 밀리지 않는다. 댓글의 `created_at`(표시·정렬)과 `updated_at`(커서)도 같은 이유로 분리돼 있다
- 세 스트림(기록·댓글·리액션)은 **각자 독립 커서**를 쓴다 — `(updated_at, id)` / `(updated_at, id)` /
  `(updated_at, entry_id, member_id)` 키셋에 같은 90초 지평선 규칙(공용 `holdOrAdvance`)을 적용한다.
  하나만 규칙이 어긋나면 그 스트림의 늦은 커밋이 영구 누락되므로 판정은 한 곳에 모아 뒀다.
  커서의 `ts`는 서버가 준 문자열 그대로 되돌려 보낸다 — ISO로 다듬으면 Postgres 마이크로초가 잘려
  같은 행을 영원히 다시 싣는다 (행 페이로드의 타임스탬프는 전부 ISO로 정규화된다)
- 배포 이행기 안전장치: 보낸 스트림의 결과(`commentResults`/`reactionResults`)가 push 응답에 없으면
  **구버전 Worker가 통째로 무시한 것**으로 보고 큐를 비우지 않고 동기화 오류로 표시한다.
  pull 응답에 그 스트림이 없으면 없는 것으로 취급하고 커서도 전진시키지 않는다 — 조용한 유실 방지
- IndexedDB 쓰기는 단일 트랜잭션(기록+큐, pull 행+커서) — 중단돼도 반쪽 상태가 없다.
  스키마는 v4 — `entries`/`queue`/`meta`에 `comments`·`commentQueue`·`reactions`·`reactionQueue`
  (v3), `notifications`·`notifReadQueue`(v4)가 더해졌다(행과 큐를 나눠 두면 큐만 지우는
  정산이 행 값을 다시 쓰지 않는다).
  같은 기기의 다른 탭과는 BroadcastChannel + 재적재로 즉시 맞춘다.
  IndexedDB가 막힌 환경에서도 메모리 전용으로 동작 (첫 렌더는 무조건 된다)
- 초대 토큰이 없으면 **데모 모드**: 시드 데이터, 동기화 없음, `?user=이름`으로 시점 변경
- 지금 상태는 멤버당 1행 — 도착 순서가 아니라 **액션 시각**으로 LWW 판정하므로 오프라인이었다
  재접속한 기기의 옛 토글이 최신 상태를 덮지 못한다. 끄는 걸 잊어도 14시간(TTL) 지나면
  꺼진 것으로 표시 — 오프라인 토글은 dirty 플래그로 남아 다음 사이클에 재전송된다
- 동기화 상태(대기 N개/오프라인/서버 오류/재로그인)는 왼쪽 컬럼에 항상 표시된다
- 서비스 워커가 앱 셸을 캐시 — 오프라인에서도 앱을 완전히 다시 열 수 있다 (API는 캐시 안 함)
- **알림** — 벨 아이콘(안읽음 배지) → 내역 페이지 + 설정 페이지.
  서버(Worker)가 사건을 알림 행으로 팬아웃한다: 공부 시작(실시간/하루 1회/끔 — 크루별
  오버라이드 가능), 내 기록의 댓글, 내 댓글의 답글(= 내가 댓글 단 기록의 후속 댓글),
  크루 전체 댓글(기본 꺼짐), `@이름` 멘션(항상), 응원 반응(바로/하루 요약/끔 — 요약은
  (수신자, 날짜)당 1행에 누적). 내역은 30일 보관, 읽음은 기기 간 동기화된다
  (`notifications`·`notif_prefs` 테이블, sync push/pull의 네 번째 스트림).
  방해 금지 시간엔 기기 푸시만 보류되고(내역 행은 그대로), 매시 정각 cron
  ([worker/notify.ts](worker/notify.ts) `runHourly`)이 창이 끝나는 시각에 다이제스트를,
  20:00 KST에 응원 하루 요약을 보낸다. 푸시는 어디서나 best-effort — 인앱 내역이 진실이다
- 기기 푸시는 PWA 웹 푸시([public/sw.js](public/sw.js) + [public/manifest.webmanifest](public/manifest.webmanifest)):
  알림 설정 페이지의 "이 기기로 알림 받기"를 켜면 이 기기가 구독된다. 아이폰은 iOS 16.4+에서
  공유 → 홈 화면에 추가한 뒤에만 켤 수 있다(앱 내 안내 문구가 뜬다).
  시크릿 `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`가 필요하다(등록 완료,
  로컬은 .dev.vars) — 키 재발급 시 기존 구독은 무효가 되니 각 기기에서 알림을 다시 켜야 한다
- 아직 없는 것(후속 과제): 댓글 수정·대댓글(스레드), 멘션 자동완성, 알림 행 탭 시 해당 기록으로 이동

## 개발

```bash
npm install
npm run dev          # 프론트 (localhost:5173, /api는 8787로 프록시)
npm run dev:worker   # Worker (localhost:8787) — .dev.vars 사용
npm test             # 동기화 SQL 테스트 (PGlite = 진짜 Postgres)
npm run check        # 전체 타입체크
```

WSL 참고: node는 nvm으로 설치됨 — `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`

## 배포 (1회 설정)

1. **Neon** — ✅ 완료: 프로젝트 `fragrant-bird-51573193`(learningCrew)가 [.neon](.neon)으로 연결되어 있고
   마이그레이션도 적용됨. 연결 문자열은 `.env.local`/`.dev.vars`(둘 다 gitignore)에 있다.
   갱신이 필요하면 `npx neon env pull`.
2. **시크릿** — `openssl rand -hex 32`로 서명 키 생성 후:
   ```bash
   npx wrangler login
   npx wrangler secret put DATABASE_URL   # Neon 연결 문자열
   npx wrangler secret put AUTH_SECRET    # 생성한 서명 키
   ```
3. **배포**:
   ```bash
   npm run deploy     # check + build + wrangler deploy
   ```
4. **(선택) 초대 링크 발급** — 이름 로그인이 기본이라 필수는 아니지만, 자동 로그인 링크가 필요하면:
   ```bash
   AUTH_SECRET=<서명 키> APP_URL=https://learning-crew.<계정>.workers.dev npm run invites
   ```

로컬에서 실서버 흐름을 시험하려면 `.dev.vars`에 실제 `DATABASE_URL`을 넣고
`npm run build && npm run dev:worker` 후 localhost:8787 접속.

## CI 자동 배포

`main`에 push하면 [GitHub Actions](.github/workflows/deploy.yml)가 테스트(PGlite) → 타입체크 → 빌드 →
`wrangler deploy`를 실행한다. 필요한 저장소 시크릿은 `CLOUDFLARE_API_TOKEN` 하나
(Cloudflare 대시보드 → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿으로 생성).
수동 실행은 Actions 탭의 workflow_dispatch.

## 설정

| 방법 | 설명 |
| --- | --- |
| 이름 선택 로그인 | 기본 흐름 — `/api/auth/claim`이 토큰 발급, localStorage 저장 |
| `?invite=<토큰>` | 자동 로그인 링크 (localStorage에 저장 후 URL에서 제거) |
| `?view=feed\|cal\|noti\|notiset` | 시작 화면 (noti = 알림 내역, notiset = 알림 설정 — 푸시 클릭이 noti로 연다) |
| `?user=이름` | 데모 모드에서만: 시점 선택 |

## 구조

- [shared/types.ts](shared/types.ts) — 도메인 타입 + 동기화 프로토콜 (클라이언트/서버 공유)
- [src/local/](src/local/) — IndexedDB 저장소, 뮤테이션 큐, SyncClient
- [src/components/](src/components/) — Board / Feed / CalendarView / EntryModal 등
- [worker/](worker/) — Hono 앱, HMAC 인증, 동기화 쿼리([queries.ts](worker/queries.ts)는 테스트와 공유)
- [migrations/](migrations/) — drizzle-kit이 생성한 SQL (`npm run db:generate`)
- 구 localStorage 기록(`e*` id, 본인 것)은 초대 접속 시 1회 자동 이관된다
