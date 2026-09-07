-- Refresh tokens stop being stored in plaintext (F100) and become jti-addressed
-- rows carrying a hash, a family, and consumption state (F101, F102, F103).
--
-- Written by hand rather than by `prisma migrate dev`, because the checked-in
-- .env DATABASE_URL points at the staging RDS instance and `migrate dev` would
-- have applied it there. Verify the target before running this.
--
-- DEPLOY CONSEQUENCE — every user signs in again, once.
--
-- Existing sessions cannot be carried across. The raw token is exactly the
-- column being removed, and the `jti` of an already-issued token lives inside a
-- JWT this migration has no way to parse, so there is nothing to derive the new
-- rows from. Clearing `activeSessionId` alongside is deliberate: leaving it
-- pointing at a deleted session id would let any access token minted before the
-- deploy keep matching, which is the one thing `activeSessionId` exists to stop.

DELETE FROM "Session";
UPDATE "Users" SET "activeSessionId" = NULL WHERE "activeSessionId" IS NOT NULL;

-- A credential column and a credential-shaped column nothing ever wrote (F106).
ALTER TABLE "Session" DROP COLUMN "refreshToken";
ALTER TABLE "Session" DROP COLUMN "accessToken";

ALTER TABLE "Session" ADD COLUMN "jti" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenHash" TEXT;
ALTER TABLE "Session" ADD COLUMN "familyId" TEXT;
ALTER TABLE "Session" ADD COLUMN "usedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "replacedByJti" TEXT;

CREATE UNIQUE INDEX "Session_jti_key" ON "Session"("jti");
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- Family revocation reads by familyId; the pruning sweep reads by user and expiry.
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
