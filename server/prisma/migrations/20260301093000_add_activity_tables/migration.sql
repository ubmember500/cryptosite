-- CreateTable
CREATE TABLE IF NOT EXISTS "UserActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "pagePath" TEXT,
    "label" TEXT,
    "element" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserDailyActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "pageViewCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UserDailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteDailyActivity" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "pageViewCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteDailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserActivityEvent_occurredAt_idx" ON "UserActivityEvent"("occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserActivityEvent_eventType_occurredAt_idx" ON "UserActivityEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserActivityEvent_userId_occurredAt_idx" ON "UserActivityEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserActivityEvent_pagePath_occurredAt_idx" ON "UserActivityEvent"("pagePath", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserDailyActivity_userId_day_key" ON "UserDailyActivity"("userId", "day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserDailyActivity_day_idx" ON "UserDailyActivity"("day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserDailyActivity_userId_day_idx" ON "UserDailyActivity"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SiteDailyActivity_day_key" ON "SiteDailyActivity"("day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SiteDailyActivity_day_idx" ON "SiteDailyActivity"("day");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'UserActivityEvent_userId_fkey'
    ) THEN
        ALTER TABLE "UserActivityEvent"
            ADD CONSTRAINT "UserActivityEvent_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'UserDailyActivity_userId_fkey'
    ) THEN
        ALTER TABLE "UserDailyActivity"
            ADD CONSTRAINT "UserDailyActivity_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
