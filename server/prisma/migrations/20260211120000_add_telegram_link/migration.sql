-- AlterTable
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramConnectedAt" DATETIME;

-- CreateTable
CREATE TABLE "TelegramConnectToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramConnectToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramConnectToken_token_key" ON "TelegramConnectToken"("token");

-- CreateIndex
CREATE INDEX "TelegramConnectToken_token_idx" ON "TelegramConnectToken"("token");

-- CreateIndex
CREATE INDEX "TelegramConnectToken_expiresAt_idx" ON "TelegramConnectToken"("expiresAt");
