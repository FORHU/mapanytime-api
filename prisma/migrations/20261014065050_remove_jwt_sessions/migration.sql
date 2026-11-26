-- Removes the JWT session machinery (#122). Better Auth sessions live in AuthSession
-- (better_auth_core); nothing reads these any more. The data loss is intended: Session
-- held refresh-token chain rows, and activeSessionId pointed into them. Every JWT session
-- ends at this deploy, which is the one re-login the cutover costs.

/*
  Warnings:

  - You are about to drop the column `activeSessionId` on the `Users` table. All the data in the column will be lost.
  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- AlterTable
ALTER TABLE "Users" DROP COLUMN "activeSessionId";

-- DropTable
DROP TABLE "Session";
