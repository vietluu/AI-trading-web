ALTER TABLE "performance_records"
ADD COLUMN "actualStartTimestamp" TIMESTAMP(3),
ADD COLUMN "actualTargetTimestamp" TIMESTAMP(3),
ADD COLUMN "timeDriftMs" INTEGER;
