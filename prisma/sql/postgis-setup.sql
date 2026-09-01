-- PostGIS objects Prisma cannot express.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Spatial index — powers conflict detection and corridor queries.
CREATE INDEX IF NOT EXISTS "LandParcel_geom_gist"
  ON "LandParcel" USING GIST (geom);

-- Centroid lookups for map clustering at low zoom.
CREATE INDEX IF NOT EXISTS "LandParcel_centroid_idx"
  ON "LandParcel" ("centroidLat", "centroidLng");

-- Only parcels flagged as conflicting, for the alert query.
CREATE INDEX IF NOT EXISTS "LandParcel_conflict_partial_idx"
  ON "LandParcel" ("projectId") WHERE "hasConflict" = true;

-- Reject invalid geometry at write time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LandParcel_geom_valid'
  ) THEN
    ALTER TABLE "LandParcel"
      ADD CONSTRAINT "LandParcel_geom_valid"
      CHECK (geom IS NULL OR ST_IsValid(geom));
  END IF;
END $$;

-- One pending objection per person per plot.
CREATE UNIQUE INDEX IF NOT EXISTS "Objection_one_pending_per_person_plot"
    ON "Objection" ("parcelId", "filedByUserId")
 WHERE "decidedAt" IS NULL
   AND "filedByUserId" IS NOT NULL
   AND "parcelId" IS NOT NULL
   AND status <> 'WITHDRAWN';
