-- CreateTable
CREATE TABLE "UserTokenSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "minWallSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTokenSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTokenSetting_userId_idx" ON "UserTokenSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTokenSetting_userId_ticker_exchange_market_key" ON "UserTokenSetting"("userId", "ticker", "exchange", "market");

-- AddForeignKey
ALTER TABLE "UserTokenSetting" ADD CONSTRAINT "UserTokenSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
