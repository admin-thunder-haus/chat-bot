-- AlterTable
ALTER TABLE "channel_accounts" ADD COLUMN     "publicId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_publicId_key" ON "channel_accounts"("publicId");

