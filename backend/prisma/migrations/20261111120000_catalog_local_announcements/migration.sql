ALTER TABLE "catalog_announcements"
  ADD COLUMN "sequence" BIGINT,
  ADD COLUMN "dedupe_key" VARCHAR(160),
  ADD COLUMN "series_id" VARCHAR(64),
  ADD COLUMN "season_number" INTEGER,
  ADD COLUMN "episode_number" INTEGER,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "poster_url" TEXT,
  ADD COLUMN "published_at" TIMESTAMPTZ(3),
  ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE "catalog_announcements"
SET "dedupe_key" = "kind" || ':' || COALESCE("series_id", '') || ':' || "content_id";

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS assigned_sequence
  FROM "catalog_announcements"
)
UPDATE "catalog_announcements" AS announcement
SET "sequence" = ordered.assigned_sequence
FROM ordered
WHERE announcement."id" = ordered."id";

ALTER TABLE "catalog_announcements" ALTER COLUMN "sequence" SET NOT NULL;

DELETE FROM "catalog_announcements" AS announcement
USING (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "dedupe_key" ORDER BY "created_at", "id") AS duplicate_number
  FROM "catalog_announcements"
) AS duplicate
WHERE announcement."id" = duplicate."id" AND duplicate.duplicate_number > 1;

ALTER TABLE "catalog_announcements" ALTER COLUMN "dedupe_key" SET NOT NULL;
CREATE UNIQUE INDEX "catalog_announcements_sequence_key" ON "catalog_announcements"("sequence");
CREATE UNIQUE INDEX "catalog_announcements_dedupe_key_key" ON "catalog_announcements"("dedupe_key");
CREATE INDEX "catalog_announcements_available_sequence_idx" ON "catalog_announcements"("available", "sequence");

CREATE TABLE "catalog_announcement_cursors" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "value" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "catalog_announcement_cursors_pkey" PRIMARY KEY ("id")
);
INSERT INTO "catalog_announcement_cursors" ("id", "value")
SELECT 1, COALESCE(MAX("sequence"), 0) FROM "catalog_announcements";
