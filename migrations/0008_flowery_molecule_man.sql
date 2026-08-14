CREATE TABLE "photo_tombstones" (
	"photo_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION tombstone_entry_photos() RETURNS trigger AS $$
BEGIN
	-- 이미 삭제된 상태로 처음 동기화된 행도 바이너리를 남기면 안 된다.
	IF TG_OP = 'INSERT' THEN
		IF NEW.deleted_at IS NOT NULL THEN
			INSERT INTO photo_tombstones (photo_id)
			SELECT DISTINCT (photo->>'id')::uuid
			FROM jsonb_array_elements(
				CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos ELSE '[]'::jsonb END
			) AS photo
			WHERE jsonb_typeof(photo) = 'object'
				AND (photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			ON CONFLICT (photo_id) DO NOTHING;
		END IF;
		RETURN NEW;
	END IF;

	-- 삭제된 행에는 현재/직전 배열 어느 쪽의 사진도 살아 있으면 안 된다.
	IF NEW.deleted_at IS NOT NULL THEN
		IF OLD.deleted_at IS NULL OR OLD.photos IS DISTINCT FROM NEW.photos THEN
			INSERT INTO photo_tombstones (photo_id)
			SELECT DISTINCT (photo->>'id')::uuid
			FROM jsonb_array_elements(
				(CASE WHEN jsonb_typeof(OLD.photos) = 'array' THEN OLD.photos ELSE '[]'::jsonb END) ||
				(CASE WHEN jsonb_typeof(NEW.photos) = 'array' THEN NEW.photos ELSE '[]'::jsonb END)
			) AS photo
			WHERE jsonb_typeof(photo) = 'object'
				AND (photo->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			ON CONFLICT (photo_id) DO NOTHING;
		END IF;
		RETURN NEW;
	END IF;

	-- 살아 있는 기록 수정은 OLD에만 남은 id를 삭제 작업으로 기록한다.
	IF OLD.photos IS DISTINCT FROM NEW.photos THEN
		INSERT INTO photo_tombstones (photo_id)
		SELECT DISTINCT (old_photo->>'id')::uuid
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
		ON CONFLICT (photo_id) DO NOTHING;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER photo_tombstones_from_entries
AFTER INSERT OR UPDATE ON entries
FOR EACH ROW EXECUTE FUNCTION tombstone_entry_photos();
