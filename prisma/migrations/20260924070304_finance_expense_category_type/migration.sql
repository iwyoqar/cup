-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_expense_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OPERATING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_expense_categories" ("createdAt", "id", "isActive", "name", "sortOrder", "updatedAt") SELECT "createdAt", "id", "isActive", "name", "sortOrder", "updatedAt" FROM "expense_categories";
DROP TABLE "expense_categories";
ALTER TABLE "new_expense_categories" RENAME TO "expense_categories";
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
