-- AlterTable
ALTER TABLE "company_ai_settings" ADD COLUMN     "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "welcomeMessage" TEXT;
