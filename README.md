# 러닝 크루 👟 (learning-crew)

4인 스터디 크루(승환·웅·태현·진주)가 하루 공부 기록을 남기고 서로의 기록을 보는 앱.
"러닝"은 running이 아니라 **learning** — 공부 크루다. 한 줄 메모 + 일기/할 일 목록,
태그(자격증/영어/코딩테스트/기타/OFF), 별점, 피드·캘린더.

**운영 URL**: https://learning-crew.running-crew.workers.dev
**로그인**: 첫 방문에 이름(아바타)을 고르면 끝 — 서버가 해당 멤버의 서명 토큰을 발급해 기기에 저장한다.
신원 검증은 없다(URL을 아는 사람 = 크루 전제). 링크가 새면 `AUTH_SECRET` 교체로 전원 로그아웃.

[Claude Design 프로토타입](https://claude.ai/design/p/601a88c4-4037-44d9-9b91-4f8b386af907)에서 출발 — 초기 정적 구현은 [legacy/](legacy/)에 보존.

## 아키텍처 — 로컬 퍼스트

```
[브라우저]  React SPA + IndexedDB 복제본 + 뮤테이션 큐   ← UI는 로컬만 읽고 쓴다 (0ms, 오프라인 동작)
    │  POST /api/sync/push   (백그라운드, 멱등 업서트)
    │  GET  /api/sync/pull   ((updated_at, id) 키셋 커서, 탭 보일 때만 20초 폴링)
[Cloudflare Worker]  인증(HMAC 초대 토큰) + 동기화 API + SPA 정적 서빙
    │  @neondatabase/serverless (HTTP)
[Neon Postgres]  진실의 원천. entries 테이블, soft delete, 서버 시계 updated_at
```

- 스택: React 19 + TypeScript + Vite / Hono / Drizzle ORM / PGlite(테스트)
- 삭제는 `deleted_at` soft delete로 전파, 수정 충돌은 행 단위 last-write-wins
- 서버는 "기존 행이 본인 것일 때만" 갱신을 허용 (`setWhere` 가드) — 남의 기록을 덮을 수 없다
- IndexedDB가 막힌 환경에서도 메모리 전용으로 동작 (첫 렌더는 무조건 된다)
- 초대 토큰이 없으면 **데모 모드**: 시드 데이터, 동기화 없음, `?user=이름`으로 시점 변경

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
| `?wit=subtle\|drip` | 카피 톤 (은은한 위트 / 낄낄 풀드립) — 저장됨 |
| `?view=feed\|cal` | 시작 탭 |
| `?user=이름` | 데모 모드에서만: 시점 선택 |

## 구조

- [shared/types.ts](shared/types.ts) — 도메인 타입 + 동기화 프로토콜 (클라이언트/서버 공유)
- [src/local/](src/local/) — IndexedDB 저장소, 뮤테이션 큐, SyncClient
- [src/components/](src/components/) — Board / Feed / CalendarView / EntryModal 등
- [worker/](worker/) — Hono 앱, HMAC 인증, 동기화 쿼리([queries.ts](worker/queries.ts)는 테스트와 공유)
- [migrations/](migrations/) — drizzle-kit이 생성한 SQL (`npm run db:generate`)
- 구 localStorage 기록(`e*` id, 본인 것)은 초대 접속 시 1회 자동 이관된다
