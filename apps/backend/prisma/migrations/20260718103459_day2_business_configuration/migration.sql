-- CreateEnum
CREATE TYPE "ServicePriceType" AS ENUM ('FIXED', 'STARTING_FROM', 'VARIABLE', 'CONTACT_US', 'FREE');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "ReplyTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'CASUAL', 'FORMAL', 'CONCISE');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "defaultLanguage" TEXT NOT NULL DEFAULT 'ar',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "responseLanguage" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Amman',
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "business_services" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "priceType" "ServicePriceType" NOT NULL DEFAULT 'FIXED',
    "durationMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "openTime" TEXT,
    "closeTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base_entries" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_ai_settings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "assistantName" TEXT,
    "systemInstructions" TEXT,
    "replyTone" "ReplyTone" NOT NULL DEFAULT 'PROFESSIONAL',
    "preferredLanguage" TEXT NOT NULL DEFAULT 'auto',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'Sorry, I couldn''t understand that. Could you rephrase?',
    "humanHandoffMessage" TEXT NOT NULL DEFAULT 'Let me connect you with a member of our team.',
    "maxReplyLength" INTEGER,
    "useEmojis" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_services_companyId_idx" ON "business_services"("companyId");

-- CreateIndex
CREATE INDEX "business_services_companyId_isActive_idx" ON "business_services"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "business_services_companyId_name_key" ON "business_services"("companyId", "name");

-- CreateIndex
CREATE INDEX "business_hours_companyId_idx" ON "business_hours"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_companyId_dayOfWeek_key" ON "business_hours"("companyId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "faqs_companyId_idx" ON "faqs"("companyId");

-- CreateIndex
CREATE INDEX "faqs_companyId_isActive_idx" ON "faqs"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_companyId_idx" ON "knowledge_base_entries"("companyId");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_companyId_isActive_idx" ON "knowledge_base_entries"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "company_ai_settings_companyId_key" ON "company_ai_settings"("companyId");

-- AddForeignKey
ALTER TABLE "business_services" ADD CONSTRAINT "business_services_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ai_settings" ADD CONSTRAINT "company_ai_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
