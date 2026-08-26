CREATE TABLE "study_days" (
	"member_id" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_days_member_id_day_pk" PRIMARY KEY("member_id","day")
);
--> statement-breakpoint
CREATE INDEX "study_days_created_at_idx" ON "study_days" USING btree ("created_at","member_id","day");--> statement-breakpoint
-- 백필: status에 남아 있는 마지막 시작 시각의 KST 날짜를 이력으로 옮긴다.
-- 이게 없으면 배포 직전에 체크인한 오늘 도장이 이력에는 없는 채로 시작한다.
-- KST는 DST가 없어 고정 +9h가 곧 시간대 변환이다 — Worker의 kstDayStr와 같은 계산.
INSERT INTO "study_days" ("member_id", "day")
SELECT "member_id", (("last_started_at" AT TIME ZONE 'UTC') + interval '9 hours')::date
FROM "status" WHERE "last_started_at" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 자정을 넘긴 마지막 세션(OFF·TTL 14시간 안쪽)의 종료일도 백필한다 — 배포 전의 라이브
-- 판정(hasTodayStudyStamp)이 이미 오늘로 세던 도장이 배포로 사라지지 않게.
-- 조건은 studyStampDays의 OFF 규칙과 같다: 시작≤종료, 14시간 미만(넘긴 건 끄는 걸 잊은 상태).
INSERT INTO "study_days" ("member_id", "day")
SELECT "member_id", (("updated_at" AT TIME ZONE 'UTC') + interval '9 hours')::date
FROM "status"
WHERE "is_on" = false AND "last_started_at" IS NOT NULL
  AND "updated_at" >= "last_started_at"
  AND "updated_at" - "last_started_at" < interval '14 hours'
ON CONFLICT DO NOTHING;