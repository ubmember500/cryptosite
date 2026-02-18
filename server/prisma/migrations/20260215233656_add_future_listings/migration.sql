-- CreateTable
CREATE TABLE "FutureListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FutureListing_exchange_idx" ON "FutureListing"("exchange");

-- CreateIndex
CREATE UNIQUE INDEX "FutureListing_exchange_symbol_key" ON "FutureListing"("exchange", "symbol");
