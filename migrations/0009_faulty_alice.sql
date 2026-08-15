ALTER TABLE "photo_tombstones" ADD COLUMN "owner" text;--> statement-breakpoint
-- 0008 시절의 행은 소유자를 복구할 수 없다. 실제 멤버와 겹치지 않는 값으로
-- 보존해 남의 객체를 지우거나 실제 소유자의 재업로드를 막지 않게 한다.
UPDATE "photo_tombstones" SET "owner" = '__legacy_unknown__' WHERE "owner" IS NULL;--> statement-breakpoint
ALTER TABLE "photo_tombstones" ALTER COLUMN "owner" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photo_tombstones" DROP CONSTRAINT "photo_tombstones_pkey";--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD CONSTRAINT "photo_tombstones_photo_id_owner_pk" PRIMARY KEY("photo_id","owner");--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD COLUMN "cleaned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD COLUMN "first_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photo_tombstones" ADD COLUMN "cleanup_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tombstone_entry_photos() RETURNS trigger AS $$
BEGIN
	-- 이미 삭제된 상태로 처음 동기화된 행도 바이너리를 남기면 안 된다.
	IF TG_OP = 'INSERT' THEN
		IF NEW.deleted_at IS NOT NULL THEN
			INSERT INTO photo_tombstones (photo_id, "owner")
			SELECT DISTINCT (photo->>'id')::uuid, NEW.member_id
			FROM jsonb_array_elements(
				CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos ELSE '[]'::jsonb END
			) AS photo
			WHERE jsonb_typeof(photo) = 'object'
				AND (photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			ON CONFLICT (photo_id, "owner") DO NOTHING;
		END IF;
		RETURN NEW;
	END IF;

	-- 삭제된 행은 OLD/NEW 배열을 각각 그 행의 소유자 범위에서 정리한다.
	IF NEW.deleted_at IS NOT NULL THEN
		IF OLD.deleted_at IS NULL OR OLD.photos IS DISTINCT FROM NEW.photos THEN
			INSERT INTO photo_tombstones (photo_id, "owner")
			SELECT DISTINCT (photo->>'id')::uuid, OLD.member_id
			FROM jsonb_array_elements(
				CASE WHEN jsonb_typeof(OLD.photos) = 'array' THEN OLD.photos ELSE '[]'::jsonb END
			) AS photo
			WHERE jsonb_typeof(photo) = 'object'
				AND (photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			ON CONFLICT (photo_id, "owner") DO NOTHING;

			INSERT INTO photo_tombstones (photo_id, "owner")
			SELECT DISTINCT (photo->>'id')::uuid, NEW.member_id
			FROM jsonb_array_elements(
				CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos ELSE '[]'::jsonb END
			) AS photo
			WHERE jsonb_typeof(photo) = 'object'
				AND (photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			ON CONFLICT (photo_id, "owner") DO NOTHING;
		END IF;
		RETURN NEW;
	END IF;

	-- 살아 있는 기록 수정은 OLD에만 남은 id를 OLD 소유자의 삭제 작업으로 기록한다.
	IF OLD.photos IS DISTINCT FROM NEW.photos THEN
		INSERT INTO photo_tombstones (photo_id, "owner")
		SELECT DISTINCT (old_photo->>'id')::uuid, OLD.member_id
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof(OLD.photos) = 'array' THEN OLD.photos ELSE '[]'::jsonb END
		) AS old_photo
		WHERE jsonb_typeof(old_photo) = 'object'
			AND (old_photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			AND NOT EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos ELSE '[]'::jsonb END
				) AS new_photo
				WHERE jsonb_typeof(new_photo) = 'object'
					AND lower(new_photo->>'id') = lower(old_photo->>'id')
			)
		ON CONFLICT (photo_id, "owner") DO NOTHING;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION filter_tombstoned_entry_photos() RETURNS trigger AS $$
BEGIN
	-- API 버전과 무관하게 DB 경계에서 해당 멤버의 삭제 원장 id만 제거한다. 순서는 보존한다.
	IF jsonb_typeof(NEW.photos) IS DISTINCT FROM 'array' THEN
		NEW.photos := '[]'::jsonb;
		RETURN NEW;
	END IF;

	SELECT COALESCE(jsonb_agg(item.photo ORDER BY item.ordinality), '[]'::jsonb)
	INTO NEW.photos
	FROM jsonb_array_elements(NEW.photos) WITH ORDINALITY AS item(photo, ordinality)
	WHERE NOT EXISTS (
		SELECT 1
		FROM photo_tombstones AS tombstone
		WHERE jsonb_typeof(item.photo) = 'object'
			AND tombstone."owner" = NEW.member_id
			AND tombstone.photo_id = CASE
				WHEN COALESCE(item.photo->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
				THEN (item.photo->>'id')::uuid
				ELSE NULL::uuid
			END
	);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER filter_tombstoned_photos_from_entries
BEFORE INSERT OR UPDATE ON entries
FOR EACH ROW EXECUTE FUNCTION filter_tombstoned_entry_photos();
