CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "post_comments_updated_at_id_idx" ON "post_comments" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "post_comments_post_id_idx" ON "post_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "posts_updated_at_id_idx" ON "posts" USING btree ("updated_at","id");--> statement-breakpoint
-- 기존 트리거 함수는 NEW/OLD의 photos·member_id·deleted_at만 보므로(테이블 이름 무관)
-- posts에 그대로 단다: 글 삭제가 사진 id를 톰스톤 원장에 남기고(R2 정리 큐),
-- 이미 삭제된 사진 id는 DB 경계에서 걸러져 구버전/늦은 push가 되살리지 못한다.
CREATE TRIGGER photo_tombstones_from_posts
AFTER INSERT OR UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION tombstone_entry_photos();--> statement-breakpoint
CREATE TRIGGER filter_tombstoned_photos_from_posts
BEFORE INSERT OR UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION filter_tombstoned_entry_photos();--> statement-breakpoint
-- filter 트리거가 같은 소유자의 삭제된 사진을 전부 걷어내면 "본문도 사진도 없는 live 글"이
-- API 검증(핸들러는 걸러지기 전 배열을 본다)을 지나 저장될 수 있다. CHECK 제약으로 막으면
-- 그 한 행이 배치 전체를 500으로 죽여 클라이언트 큐가 영영 정산되지 않으므로, 대신 빈 live
-- 행을 tombstone으로 강등해 저장한다 — applied 응답의 deleted_at을 본 클라이언트가 로컬
-- 행을 정리하며 정상 정산되고, "삭제는 단조" 규약과도 어긋나지 않는다.
-- (BEFORE 트리거는 이름의 알파벳 순서로 실행된다: filter_… 뒤에 이 트리거가 와야 한다)
CREATE FUNCTION tombstone_empty_live_posts() RETURNS trigger AS $$
BEGIN
	IF NEW.deleted_at IS NULL AND btrim(NEW.body) = ''
		AND (jsonb_typeof(NEW.photos) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.photos) = 0) THEN
		NEW.deleted_at := now();
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tombstone_empty_live_posts
BEFORE INSERT OR UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION tombstone_empty_live_posts();