ALTER TABLE "entries" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- 기존 행 백필 — 단일 태그를 그대로 1개짜리 배열로 올린다.
-- (읽기 경계의 entryTags가 빈 배열도 tag로 되살리지만, 저장된 값 자체를 맞춰 두어야
--  jsonb 기준 조회·검증이 신·구 행을 같게 본다)
UPDATE "entries" SET "tags" = jsonb_build_array("tag") WHERE jsonb_array_length("tags") = 0;
