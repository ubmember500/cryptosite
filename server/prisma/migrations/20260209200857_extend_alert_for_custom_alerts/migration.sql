-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "exchange" TEXT NOT NULL DEFAULT 'binance',
    "market" TEXT NOT NULL DEFAULT 'futures',
    "alertType" TEXT NOT NULL DEFAULT 'price',
    "description" TEXT,
    "symbols" TEXT,
    "conditions" TEXT,
    "notificationOptions" TEXT,
    "coinId" TEXT NOT NULL,
    "coinSymbol" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "targetValue" REAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Alert" ("coinId", "coinSymbol", "condition", "createdAt", "id", "isActive", "targetValue", "triggered", "triggeredAt", "userId") SELECT "coinId", "coinSymbol", "condition", "createdAt", "id", "isActive", "targetValue", "triggered", "triggeredAt", "userId" FROM "Alert";
DROP TABLE "Alert";
ALTER TABLE "new_Alert" RENAME TO "Alert";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
