-- CreateTable
CREATE TABLE "ApiKeys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeys_keyHash_key" ON "ApiKeys"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKeys_userId_idx" ON "ApiKeys"("userId");

-- AddForeignKey
ALTER TABLE "ApiKeys" ADD CONSTRAINT "ApiKeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
